// App container spec (#25). The ONLY place app containers are defined: the
// orchestrator creates every app container from this, so the security-relevant
// settings (no docker.sock, non-root, read-only rootfs, no capabilities,
// state only via the data volume, secrets only from /data env files) cannot
// drift between bootstrap and updates. See SECURITY.md.

export const DEFAULT_NETWORKS = Object.freeze({
  front: "sparky-front", // internal: proxy <-> apps
  control: "sparky-control", // internal: orchestrator <-> apps, app <-> app handover
  egress: "sparky-app-egress", // outbound: PLC, SMTP, DNS
});

export const DATA_VOLUME = "sparky-data";
export const APP_PORT = 3000;
export const HANDOVER_PORT = 3100;

/** Container name for an app of `version`; `suffix` makes it unique. */
export function appContainerName(version, suffix) {
  const v = String(version || "unknown").replace(/[^0-9A-Za-z.-]/g, "-").slice(0, 40);
  const s = String(suffix).replace(/[^0-9a-f]/gi, "").slice(0, 12);
  if (!s) throw new Error("appContainerName needs a hex suffix");
  return `sparky-app-${v}-${s}`;
}

/**
 * @param {object} o
 * @param {string} o.image          image reference (digest-pinned for updates)
 * @param {string} o.name           container name
 * @param {string} o.version        product version (label only)
 * @param {string} o.tz             device IANA time zone
 * @param {string} o.orchUrl        orchestrator control URL
 * @param {string} o.orchToken      this container's control token
 * @param {string} o.controlSubnet  CIDR of the control network
 * @param {string} [o.backupHostDir] host dir for daily DB backups
 * @param {{predecessor: string, handoverToken: string} | null} [o.standby]
 * @param {typeof DEFAULT_NETWORKS} [o.networks]
 * @param {string} [o.dataVolume]
 * @returns {{ create: object, extraNetworks: string[] }}
 *   `create` is the Engine API body for POST /containers/create; connect
 *   `extraNetworks` before starting the container.
 */
export function buildAppContainerSpec({
  image,
  name,
  version,
  tz,
  orchUrl,
  orchToken,
  controlSubnet,
  backupHostDir = "",
  standby = null,
  networks = DEFAULT_NETWORKS,
  dataVolume = DATA_VOLUME,
}) {
  for (const [key, value] of Object.entries({ image, name, tz, orchUrl, orchToken, controlSubnet })) {
    if (!value) throw new Error(`buildAppContainerSpec: ${key} is required`);
  }

  // Non-secret settings only. Secrets and device config (admin hash, session
  // secret, bridge token, SMTP, PLC_MODE/PLC_IP) come from /data/*.env.
  const env = [
    "NODE_ENV=production",
    "SPARKY_DATA_DIR=/data",
    "SPARKY_DB_FILE=prod.sqlite",
    `PORT=${APP_PORT}`,
    "BRIDGE_HOST=127.0.0.1",
    "BRIDGE_PORT=8000",
    "TRUST_PROXY=1",
    `TZ=${tz}`,
    `SPARKY_CONTAINER_NAME=${name}`,
    `SPARKY_CONTROL_SUBNET=${controlSubnet}`,
    `SPARKY_HANDOVER_PORT=${HANDOVER_PORT}`,
    `SPARKY_ORCH_URL=${orchUrl}`,
    `SPARKY_ORCH_TOKEN=${orchToken}`,
  ];
  if (backupHostDir) env.push("SPARKY_BACKUP_DIR=/backups");
  if (standby) {
    if (!standby.predecessor || !standby.handoverToken)
      throw new Error("buildAppContainerSpec: standby needs predecessor and handoverToken");
    env.push(
      "SPARKY_STANDBY=1",
      `SPARKY_PREDECESSOR=${standby.predecessor}`,
      `SPARKY_HANDOVER_TOKEN=${standby.handoverToken}`,
    );
  }

  const mounts = [{ Type: "volume", Source: dataVolume, Target: "/data" }];
  if (backupHostDir) mounts.push({ Type: "bind", Source: backupHostDir, Target: "/backups" });

  return {
    create: {
      Image: image,
      User: "node",
      Env: env,
      Labels: { "sparky.role": "app", "sparky.version": String(version || ""), "sparky.name": name },
      StopTimeout: 30,
      HostConfig: {
        Init: true,
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        // A standby container must never be revived by Docker on its own; it
        // becomes unless-stopped only when promoted.
        RestartPolicy: { Name: standby ? "no" : "unless-stopped" },
        Mounts: mounts,
        NetworkMode: networks.front,
      },
      NetworkingConfig: { EndpointsConfig: { [networks.front]: {} } },
    },
    extraNetworks: [networks.control, networks.egress],
  };
}

/**
 * One-off helper that restores a pre-update DB snapshot (rollback). Runs the
 * OLD image's deploy/container/restore-snapshot.mjs with no network.
 * Exit codes: 0 restored, 3 snapshot missing, anything else failed.
 */
export function buildRestoreHelperSpec({ image, updateId, dataVolume = DATA_VOLUME }) {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(updateId || "")) throw new Error("Invalid updateId");
  return {
    Image: image,
    User: "node",
    Cmd: [
      "node",
      "deploy/container/restore-snapshot.mjs",
      "--snapshot",
      `/data/backups/pre-${updateId}.sqlite`,
      "--db",
      "/data/prod.sqlite",
    ],
    Labels: { "sparky.role": "helper" },
    HostConfig: {
      NetworkMode: "none",
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=16m" },
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Mounts: [{ Type: "volume", Source: dataVolume, Target: "/data" }],
    },
  };
}
