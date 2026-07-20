# Sparky Control System

A modern web application for controlling and monitoring the **Sparky** cable‑pulling
machine, replacing the legacy VBA/Excel control system. It runs on an on‑prem **edge
device** wired to a Rockwell ControlLogix PLC and is accessed over the local network
by a browser.

> **Version 3.0.0** is an in‑progress overhaul: a finished (and simulator‑backed) PLC
> bridge, a facelifted UI with an Admin Dashboard, stronger data validation and access
> control, a real production launch, and a CI/CD + edge‑update pipeline.

## Architecture

```
Browser (LAN users)  ──HTTP──►  Backend (Express, :3000, 0.0.0.0)
   Checkout page                  │   • REST API + SQLite (better-sqlite3)
   Admin Dashboard                │   • serves the built React app (same origin)
                                  │   • weekly email report (node-cron + nodemailer)
                                  │
                                  └──HTTP (127.0.0.1 only)──►  PLC bridge microservice (:8000)
                                                                 • EtherNet/IP  ──►  ControlLogix PLC
                                                                 • or behavioral simulator (PLC_MODE=sim)
```

- **Frontend** — React 18 + Vite 6 (+ Tailwind). Built output is served by the backend
  in production (same origin); a Vite dev server is used only for local development.
- **Backend** — Node.js + Express (ESM). REST API, business logic, auth, reporting,
  and the authenticated **gateway** to the PLC bridge. Database is **SQLite** (file‑based,
  via `better-sqlite3`).
- **PLC bridge microservice** — the *only* component that talks to the PLC. Bound to
  `127.0.0.1` so remote users can never reach the machine directly; the backend proxies
  validated, intent‑based requests to it. Selectable driver: a live **EtherNet/IP**
  connection (`PLC_MODE=real`) or a **behavioral simulator** (`PLC_MODE=sim`) for
  hardware‑free development, testing, and CI.
- **Runtime** — Node cannot be installed on the locked‑down edge device, so a **portable
  Node runtime** is bundled in `runtime/node-portable` and every process is launched
  through it.

> Note: earlier docs described a MySQL/RSLinx‑DDE stack. The live system uses SQLite and a
> direct EtherNet/IP client; the DDE/OPC and MySQL paths have been retired.

## Repository layout

```
backend/        Express API, SQLite, reporting, PLC gateway
frontend/       React + Vite single-page app (built into backend/src/public)
microservice/   PLC bridge (EtherNet/IP driver + behavioral simulator)
runtime/        Portable Node runtime (node.exe) — the only Node on the edge device
deploy/         Edge updater (updater.mjs)
data/           Runtime data (SQLite DB, backend.env, microservice.env, logs) — git-ignored, outside releases
sparky.bat      Single entry point: start / stop / build / update / register
```

## Database

SQLite, created/upgraded programmatically on boot (`backend/src/init`). Core tables:
`users`, `projects`, `items`, `checkouts`, plus `report_recipients` and
`weekly_report_status`. The DB file and secrets live in `SPARKY_DATA_DIR`
(default `./data`), **outside** the code/release tree so updates never clobber data.

### Data directory & database file

Where the data lives and how the DB file is named is controlled by these env vars:

| Variable | Meaning | Default |
|---|---|---|
| `SPARKY_DATA_DIR` | Directory holding the SQLite DB, `backend.env`, `microservice.env`, and `logs/`. Kept outside the release tree so updates never touch it. | `<repo>/data` |
| `NODE_ENV` | Selects the default DB file name. | `development` |
| `SPARKY_DB_FILE` | Overrides the DB file name (bare filename, lives in `SPARKY_DATA_DIR`). | — |

The DB file name follows `NODE_ENV`: **`dev.sqlite`** in development, **`prod.sqlite`**
in production, `test.sqlite` under test. So the full path is
`%SPARKY_DATA_DIR%\<env>.sqlite` (e.g. `data\prod.sqlite` in production). Set
`SPARKY_DB_FILE=something.sqlite` only if you need a non-default name.

Each service loads its own env file from the data dir: the backend reads
`%SPARKY_DATA_DIR%\backend.env` and the PLC bridge reads
`%SPARKY_DATA_DIR%\microservice.env`. `SPARKY_DATA_DIR` itself must come from
the OS environment — `sparky.bat` exports it (defaulting to `<repo>\data`)
before launching either service; when a service is run directly without
`sparky.bat`, it falls back to the same `<repo>/data` default.

Precedence (highest first): real OS environment →
`%SPARKY_DATA_DIR%\backend.env` (or `microservice.env` for the bridge).

> **First production boot:** the legacy stack ran as `NODE_ENV=development`, so its
> live data is in `dev.sqlite`. On the first `--prod` start, if no `prod.sqlite`
> exists yet but a `dev.sqlite` is present in the data dir, the backend copies it to
> `prod.sqlite` once (logging a NOTICE). Confirm the data, then remove the old
> `dev.sqlite`.

## Getting started (development)

Prerequisites: Node 23.6.0 (matches the bundled runtime) and npm.

```bash
# install deps in each package
(cd backend && npm install)
(cd frontend && npm install)
(cd microservice && npm install)

# configure (env files live in the shared data/ dir)
cp backend/.env.example data/backend.env             # then fill in the blanks
cp microservice/.env.example data/microservice.env

# run (three terminals; on Windows just: sparky start)
(cd microservice && PLC_MODE=sim npm run dev)   # virtual PLC on 127.0.0.1:8000
(cd backend && npm run dev)                      # API + gateway on :3000
(cd frontend && npm run dev)                     # Vite dev server on :5173
```

On Windows, `sparky start` launches all three (bridge in sim mode, backend, Vite)
through the bundled portable Node — no global Node install required.

With `PLC_MODE=sim` the microservice exposes sim‑control endpoints (start/complete/reset a
pull) so the full Checkout flow can be exercised without hardware.

## Configuration

All configuration is via environment variables; see `backend/.env.example` and
`microservice/.env.example`. Secrets (email password, admin password hash,
session/bridge secrets) belong only in `SPARKY_DATA_DIR/backend.env` and
`SPARKY_DATA_DIR/microservice.env`, never in tracked scripts.

Generate the admin password hash and a session secret:

```bash
node backend/scripts/hash-password.js "your admin password"   # -> ADMIN_PASSWORD_HASH=...
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # -> SESSION_SECRET / BRIDGE_TOKEN
```

## Deployment (edge device)

Production runs natively via the bundled portable Node runtime — nothing is installed on
the device.

A single `sparky.bat` is the only entry point (dev and prod, via flags):

```bat
sparky build                :: npm ci --omit=dev (backend + microservice) + vite build
sparky start --prod         :: serve UI+API on :3000, PLC bridge on 127.0.0.1:8000, supervised
sparky start --prod --sim   :: same, but run the simulator (commissioning)
sparky stop                 :: stop the running services
sparky register             :: (once, elevated) run "sparky start --prod" at boot
```

`sparky start --prod` forces `NODE_ENV=production` and (unless `--sim` is given)
`PLC_MODE=real`; each service runs in its own restart-on-crash supervised window.
`sparky start` alone is the dev launcher (Vite + nodemon + sim bridge).

- The built frontend is served by Express on a single port; there is no Vite server and
  no `--host` in production. `PLC_MODE=real` connects to the PLC; `PLC_MODE=sim` runs the
  simulator for commissioning.
- Data (SQLite DB, `backend.env`/`microservice.env`, logs) lives in `SPARKY_DATA_DIR`
  (default `.\data`), outside the code/release tree, so updates never clobber it.

### Remote updates

CI/CD lives in `.github/workflows`:

- **ci.yml** — on every push/PR: backend + microservice `node --test` (PLC bridge tested
  with `PLC_MODE=sim`) and the frontend lint + build. Node is pinned to 23.6.0 to match the
  portable runtime.
- **release.yml** — on a `v*` tag: runs the tests, builds the frontend, installs win‑x64
  production deps (bundling the `better-sqlite3` prebuild), zips a bundle with a SHA‑256
  `manifest.json`, and publishes a GitHub Release.

On the device, `sparky update` (or the Admin Dashboard → System → *Check & apply
update*) runs the Node updater (`deploy/updater.mjs`) from `%TEMP%` so nothing executes
from inside the tree being replaced: it compares the installed version to the latest
release, downloads and **verifies the SHA‑256**, backs up the current install (dirs +
`sparky.bat`), swaps in the new code, restarts via `sparky start --prod`, health‑checks
`/health`, and **rolls back automatically** on failure. It uses only the portable
`node.exe` and Windows‑built‑in `tar` — no PowerShell. Use `sparky update --check` to
report an available update without applying it.

> Optional: a `Dockerfile`/compose can be added for a reproducible dev/CI environment, but
> the edge device itself runs natively (Docker can't be installed there either).

## Real‑PLC checklist

The live EtherNet/IP path (`PLC_MODE=real`) cannot be exercised without the hardware.
Before relying on it on‑site:

1. Confirm the tag names/types in `microservice/src/tags.js` against the running PLC program
   (encoder `quantity`/`backupQuantity` are REAL, `completeRequest`/`completeAck` are BOOL,
   the operator strings are STRING, `stepNumber` is DINT).
2. Set `PLC_IP` (and `PLC_SLOT` if not 0) in the data‑dir `microservice.env`.
3. Verify connectivity from the Admin Dashboard → System → PLC diagnostics (*Read all tags*).
4. Dry‑run a pull with the physical HMI and confirm the encoder ramps and `completeRequest`
   fires as the Checkout monitor expects.

## License

ISC.
