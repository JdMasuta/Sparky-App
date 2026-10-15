# Security

This document describes the security scheme for the Sparky Cart container
deployment (Docker CE in WSL2 on the Windows edge device), its threat model,
and the risks that remain.

> **Status:** this is the approved design for issue #25. The container
> deployment is **not implemented yet**; today Sparky runs natively via
> `sparky.bat`. The native deployment stays supported for two releases after
> the container cutover.

## Threat model

**Assets**

- The SQLite database (users, projects, items, checkouts).
- Secrets: the admin password hash, the session-signing secret, the PLC bridge
  token, and the SMTP credentials.
- Control of the PLC through the PLC bridge.
- Control of the Docker engine, which amounts to control of the WSL2 host.

**In scope.** The design aims to leave only two ways to compromise the
system:

- **(a) Shell access to a running container.**
- **(b) A compromised update artifact**: a malicious or tampered image or
  release manifest.

A client on the plant LAN reaches only the proxy. Through the proxy it reaches
only the app's HTTP API, which enforces the app's own authentication. No LAN
path leads to the Docker engine, the host, or stored state.

**Out of scope**

- Physical access to the device.
- Compromise of the Windows host or its user accounts. A Windows login on the
  device can open a root shell in the WSL distro, and from there control
  Docker.
- Compromise of the plant network or of the PLC itself.

## Security scheme

### Container layout

| Container | Role | LAN-facing | `docker.sock` | Holds state or secrets |
|---|---|---|---|---|
| **proxy** | Publishes `:3000` and forwards HTTP to whichever app container is active. Deliberately dumb. | Yes | No | No |
| **orchestrator** | Pulls, starts, stops, and rolls back app containers. Runs the update procedure. Tiny codebase. | No; its control API listens on an unpublished port | Yes | Only its own control token and update state |
| **app** (old/new) | Backend, built frontend, and PLC bridge. Old and new are interchangeable. | No; reached only through the proxy | No | Reads secrets and the DB from mounted storage. The image itself has none. |

### Trust boundaries

1. **LAN → proxy.** All input is untrusted. The proxy only forwards HTTP.
2. **Proxy → app.** The app enforces admin authentication. Operator checkout
   endpoints are open by design (see [residual risks](#known-vulnerabilities-and-residual-risks)).
3. **App → orchestrator.** Requests travel over an internal network to an
   unpublished port and require a token. The orchestrator accepts only a fixed
   set of update operations. It resolves images from the release manifest and
   never takes an image reference from the caller.
4. **Orchestrator → Docker engine.** Fully trusted. The orchestrator is the
   crown jewel.
5. **Registry and GitHub releases → orchestrator.** Untrusted until the
   image digest matches the release manifest.
6. **App → PLC.** Trusted plant network. The PLC bridge listens on loopback
   inside the app container, so only the app's backend can call it.

### What each container can and cannot do

| Container | Can | Cannot |
|---|---|---|
| **proxy** | Accept LAN HTTP on `:3000` and forward it to the active app container | Reach the Docker engine, the database, the secrets, or the orchestrator's control API |
| **orchestrator** | Control the Docker engine; fetch the release manifest; pull images by digest; start, stop, and roll back app containers | Be reached from the LAN or through the proxy; run an image whose digest does not match the manifest |
| **app** | Serve the UI and API; read and write the database; read its configuration and secrets from mounted storage; drive the PLC through the bridge; send report email; ask the orchestrator to run an update | Reach the Docker engine or the host; choose which image gets deployed; keep any state inside the image |

### Persistence

Images contain code only. They hold no database, secrets, or device
configuration, so replacing a container never touches state.

| Item | Where it lives |
|---|---|
| Admin password | `ADMIN_PASSWORD_HASH` (a scrypt hash, never the plaintext) in `$SPARKY_DATA_DIR/backend.env`, mounted into the app container |
| Other secrets and device config (session secret, bridge token, SMTP, PLC IP) | Env files in `$SPARKY_DATA_DIR`, mounted into the app container |
| Database | `prod.sqlite` in the named Docker volume `sparky-data` |
| Backups | A daily copy of the database in `C:/SparkyData/backups` on the Windows host |

### Update integrity and procedure

1. **Trigger.** An authenticated admin starts an update from the Admin page.
   The app forwards the request to the orchestrator using its token.
2. **Update window.** Updates run only between **17:00 and 03:00 device local
   time**. A request made outside the window is queued. Once a handover starts,
   it always finishes, even if that runs past 03:00.
3. **Integrity check.** The orchestrator pulls the new image **by digest** and
   verifies it against the release manifest before the new container starts.
4. **Drain.** The old container stops accepting new checkouts. It waits up to
   **10 minutes** for in-flight checkouts to finish. If any are still running
   after that, the update is postponed and the old container keeps serving.
5. **Handover.** The old container shuts down gracefully, closing the database
   and the PLC session. It then sends a handshake to the new container, which
   waits for that handshake before starting its own services.
6. **Health check.** If the new container fails its health check, the previous
   version is restored.

### How the design addresses each vector

**(a) Shell in a running container.** The damage is limited to that
container's privileges:

- **Proxy:** the attacker can read and alter HTTP traffic passing through it.
  They gain no Docker access and no stored secrets or data.
- **App:** the attacker gets the database, the app's secrets, and PLC writes
  through the bridge. They cannot reach Docker or the host. Restarting the
  container from its image removes anything they planted inside it.
- **Orchestrator:** the attacker gets full Docker control. To reduce the
  chance of this, the orchestrator is never exposed to the LAN, its control
  port is unpublished and needs a token, it accepts a fixed set of operations,
  and its codebase is kept small.

**(b) Compromised update artifact.**

- Digest pinning means the image that runs is exactly the one the release
  manifest names. A swapped tag or a tampered registry copy is rejected.
- A malicious app image still runs with only app-container privileges, without
  `docker.sock`.
- Signing, which would prove the manifest itself came from a trusted build, is
  not implemented yet (see below).

### Application-level controls (implemented today)

- The admin password is stored only as a scrypt hash.
- Admin sessions are HMAC-signed, `httpOnly`, `SameSite=Strict` cookies.
- Admin mutations require a custom CSRF header.
- Rate limits apply to the API and to failed logins.
- Operator checkout requests are validated against the database, and only
  whitelisted PLC tags can be written. The browser never reaches the PLC bridge
  directly.

## Known vulnerabilities and residual risks

- **Orchestrator compromise means full Docker control.** `docker.sock` gives
  root-equivalent control of the WSL2 host. Through mounts, that includes the
  Windows drive. It is mitigated by isolation and a minimal attack surface, but
  not eliminated.
- **No TLS on the LAN.** The admin password at login and the session cookie
  travel in plaintext. The proxy, and anyone who can sniff the LAN segment, can
  see them. The cookie cannot be marked `Secure`. TLS is currently out of
  scope.
- **No image signing yet.** Digest pinning protects only the path from manifest
  to image. Anyone who can publish a release can point the manifest at a
  malicious image, for example through a compromised GitHub account, token, or
  workflow. Signing is tracked in #30.
- **App container compromise exposes everything the app holds.** That includes
  the database, the session-signing secret (an attacker can mint admin
  sessions), the bridge token, the SMTP credentials, and PLC writes. This comes
  with the app's role.
- **Database loss on engine removal.** `sparky-data` lives on the WSL distro's
  virtual disk. Unregistering the distro or uninstalling Docker deletes it, and
  so does a data purge on the Docker Desktop fallback. The daily host backup
  limits the loss to at most one day of data.
- **Host backups are plain files.** Copies in `C:/SparkyData/backups` are
  unencrypted SQLite files that Windows users of the device can read.
- **Node 23.6.0 is end-of-life.** It no longer receives security patches. The
  version is pinned to match the current runtime and CI.
- **Operator endpoints are unauthenticated by design.** Anyone who can reach
  `:3000` can drive the checkout flow, within the whitelisted tags and
  database-validated values.
- **Outbound traffic is not filtered.** Containers can open outbound
  connections. A shell in the proxy could reach the PLC or other LAN hosts
  directly.
- **Rate limiting may not see real client IPs.** If the WSL networking path
  hides client addresses, all clients share one rate-limit bucket. That weakens
  login throttling and lets one client exhaust the shared limit.
- **Content-Security-Policy is disabled.** It stays off until the frontend no
  longer loads external scripts.

## Future mitigations

All of these are **planned, not implemented**.

| Mitigation | Addresses |
|---|---|
| TLS on the LAN-facing proxy | Plaintext admin password and session cookie; `Secure` cookies |
| Image signing with cosign, verified by the orchestrator before start (#30) | Compromised update artifact |
| Security scan gate before the first public image publish: secret scan, Dockerfile hygiene (non-root user, pinned base images, no secrets in layers), and an image vulnerability scan that blocks on HIGH/CRITICAL findings | Vulnerable or secret-bearing images |
| Upgrade to a supported Node LTS | End-of-life runtime |
| Egress filtering on the host (`DOCKER-USER` rules): no outbound traffic from the proxy; app limited to the PLC, SMTP, and DNS | Pivoting from a compromised container |
| Proxy forwards the real client IP; the app trusts that header only from the proxy | Shared rate-limit bucket |
| Strict same-origin Content-Security-Policy | Injected script |

## Reporting a vulnerability

Report suspected vulnerabilities privately to the repository maintainer rather
than in a public issue.
