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
deploy/         Production launch + update scripts (added in v3)
data/           Runtime data (SQLite DB, .env, logs) — git-ignored, outside releases
setup.bat       Sets PATH to portable Node + non-secret env defaults
start.bat       Local development launcher
```

## Database

SQLite, created/upgraded programmatically on boot (`backend/src/init`). Core tables:
`users`, `projects`, `items`, `checkouts`, plus `report_recipients` and
`weekly_report_status`. The DB file and secrets live in `SPARKY_DATA_DIR`
(default `./data`), **outside** the code/release tree so updates never clobber data.

## Getting started (development)

Prerequisites: Node 23.6.0 (matches the bundled runtime) and npm.

```bash
# install deps in each package
(cd backend && npm install)
(cd frontend && npm install)
(cd microservice && npm install)

# configure
cp backend/.env.example backend/.env   # then fill in the blanks

# run (three terminals, or use the dev launcher on Windows)
(cd microservice && PLC_MODE=sim npm run dev)   # virtual PLC on 127.0.0.1:8000
(cd backend && npm run dev)                      # API + gateway on :3000
(cd frontend && npm run dev)                     # Vite dev server on :5173
```

With `PLC_MODE=sim` the microservice exposes sim‑control endpoints (start/complete/reset a
pull) so the full Checkout flow can be exercised without hardware.

## Configuration

All configuration is via environment variables; see `backend/.env.example`. Secrets
(email password, admin password hash, session/bridge secrets) belong only in
`SPARKY_DATA_DIR/.env`, never in tracked scripts.

## Deployment

Production runs natively on the edge device via the portable Node runtime — the frontend
is built to static files and served by Express on a single port; the backend and PLC
bridge are supervised. Remote updates are delivered as versioned GitHub Releases and
applied on‑device by an updater with checksum verification and rollback. See `deploy/`
(added during the v3 CI/CD work).

## License

ISC.
