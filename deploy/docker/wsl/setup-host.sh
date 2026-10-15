#!/usr/bin/env bash
# Sparky Docker host tooling (#25). Runs as root inside the sparky-host WSL
# distro (sparky-docker.bat calls it), or on any Linux Docker host for testing.
#
#   setup-host.sh engine                       install docker-ce + compose, systemd, keepalive, edge.env
#   setup-host.sh install                      create volumes/network, start proxy + orchestrator
#   setup-host.sh import-data <dir> [real|sim] copy a native data dir into the sparky-data volume
#   setup-host.sh set-admin-password           change the admin password (reads stdin), restart the app
#   setup-host.sh status                       containers, update status
#   setup-host.sh logs [proxy|orchestrator|app] [lines]
#   setup-host.sh start | stop
#   setup-host.sh upgrade-edge <image@sha256:...>
#
# Config: SPARKY_EDGE_ENV (default /etc/sparky/edge.env).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(dirname "$HERE")"
COMPOSE_FILE="$DOCKER_DIR/compose.yaml"
EDGE_ENV="${SPARKY_EDGE_ENV:-/etc/sparky/edge.env}"
VOLUMES=(sparky-data sparky-edge-state sparky-route)

die() { echo "sparky: $*" >&2; exit 1; }
log() { echo "sparky: $*"; }

load_env() {
  [[ -f "$EDGE_ENV" ]] || die "$EDGE_ENV not found (run 'engine' first, or set SPARKY_EDGE_ENV)"
  set -a
  # shellcheck disable=SC1090
  source "$EDGE_ENV"
  set +a
  if [[ -z "${DOCKER_GID:-}" ]]; then
    DOCKER_GID="$(stat -c %g /var/run/docker.sock)"
    export DOCKER_GID
  fi
}

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$EDGE_ENV" -p sparky "$@"; }

app_containers() { docker ps -a --filter label=sparky.role=app --format '{{.Names}}'; }
running_apps() { docker ps --filter label=sparky.role=app --format '{{.Names}}'; }

# Run a one-off helper in the app image with the data volume and no network.
run_helper() {
  local tty=(-i)
  [[ -t 0 ]] && tty=(-it)
  docker run --rm "${tty[@]}" --user node --network none --read-only --tmpfs /tmp \
    --cap-drop ALL --security-opt no-new-privileges:true \
    -v sparky-data:/data "$@"
}

cmd_engine() {
  [[ $EUID -eq 0 ]] || die "engine must run as root"
  # shellcheck disable=SC1091
  source /etc/os-release
  log "installing docker-ce from download.docker.com ($ID $VERSION_CODENAME)"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  local pkgs=(docker-ce docker-ce-cli containerd.io docker-compose-plugin)
  if [[ -n "${DOCKER_CE_VERSION:-}" ]]; then
    pkgs=("docker-ce=$DOCKER_CE_VERSION" "docker-ce-cli=$DOCKER_CE_VERSION" containerd.io docker-compose-plugin)
  fi
  apt-get install -y -qq "${pkgs[@]}" >/dev/null
  # Engine upgrades happen deliberately, not via unattended apt runs.
  apt-mark hold docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
  log "installed $(docker --version)"

  install -m 0644 "$HERE/wsl.conf" /etc/wsl.conf
  cat >/usr/local/sbin/sparky-keepalive <<'EOF'
#!/bin/sh
# Held open by the Windows startup task: WSL stops a distro once no wsl.exe
# process is attached, even while systemd services run.
systemctl start docker 2>/dev/null || service docker start
exec sleep infinity
EOF
  chmod 0755 /usr/local/sbin/sparky-keepalive
  if [[ "$(ps -p 1 -o comm=)" == "systemd" ]]; then
    systemctl enable --now docker >/dev/null
  else
    log "systemd is not PID 1 yet; restart the distro (wsl --terminate sparky-host) to apply /etc/wsl.conf"
  fi

  if [[ ! -f "$EDGE_ENV" ]]; then
    install -d -m 0755 "$(dirname "$EDGE_ENV")"
    install -m 0644 "$DOCKER_DIR/edge.env.example" "$EDGE_ENV"
    local tz gid
    tz="$(readlink /etc/localtime | sed 's|.*/zoneinfo/||')"
    gid="$(getent group docker | cut -d: -f3)"
    sed -i "s|^SPARKY_TZ=.*|SPARKY_TZ=$tz|; s|^DOCKER_GID=.*|DOCKER_GID=$gid|" "$EDGE_ENV"
    log "created $EDGE_ENV (SPARKY_TZ=$tz, DOCKER_GID=$gid); set the image digests before 'install'"
  fi
}

cmd_install() {
  load_env
  [[ -n "${SPARKY_TZ:-}" ]] || die "SPARKY_TZ is empty in $EDGE_ENV"
  for v in "${VOLUMES[@]}"; do
    docker volume inspect "$v" >/dev/null 2>&1 || { docker volume create "$v" >/dev/null && log "created volume $v"; }
  done
  if ! docker network inspect sparky-app-egress >/dev/null 2>&1; then
    docker network create --subnet "${SPARKY_APP_EGRESS_SUBNET:-172.30.4.0/24}" sparky-app-egress >/dev/null
    log "created network sparky-app-egress"
  fi
  if [[ -n "${SPARKY_BACKUP_HOST_DIR:-}" ]]; then mkdir -p "$SPARKY_BACKUP_HOST_DIR"; fi
  compose up -d
  log "started; the orchestrator brings up the app (check: setup-host.sh status)"
}

cmd_import_data() {
  load_env
  local src="${1:-}" mode="${2:-}"
  [[ -n "$src" && -d "$src" ]] || die "usage: import-data <native data dir> [real|sim]"
  [[ -n "${SPARKY_APP_IMAGE:-}" ]] || die "SPARKY_APP_IMAGE is empty in $EDGE_ENV"
  docker volume inspect sparky-data >/dev/null 2>&1 || docker volume create sparky-data >/dev/null
  local args=(--from /import)
  [[ -n "$mode" ]] && args+=(--plc-mode "$mode")
  run_helper -v "$(cd "$src" && pwd)":/import:ro "$SPARKY_APP_IMAGE" node deploy/container/import-data.mjs "${args[@]}"
}

cmd_set_admin_password() {
  load_env
  local app
  app="$(running_apps | head -n1)"
  local image="${SPARKY_APP_IMAGE:-}"
  if [[ -n "$app" ]]; then image="$(docker inspect -f '{{.Config.Image}}' "$app")"; fi
  [[ -n "$image" ]] || die "no app image known"
  run_helper "$image" node deploy/container/set-admin-password.mjs
  if [[ -n "$app" ]]; then
    docker restart "$app" >/dev/null
    log "restarted $app to apply the new password"
  fi
}

cmd_status() {
  load_env
  compose ps
  echo
  docker ps -a --filter label=sparky.role=app --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
  echo
  docker exec sparky-proxy node -e \
    "fetch('http://127.0.0.1:3000/__edge/status').then(r=>r.text()).then(t=>console.log(t),e=>console.log('status unavailable:',e.message))" \
    2>/dev/null || echo "proxy is not running"
}

cmd_logs() {
  load_env
  local which="${1:-orchestrator}" lines="${2:-200}"
  case "$which" in
    proxy | orchestrator) docker logs --tail "$lines" "sparky-$which" ;;
    app)
      local app
      app="$(running_apps | head -n1)"
      [[ -n "$app" ]] || app="$(app_containers | head -n1)"
      [[ -n "$app" ]] || die "no app container"
      docker logs --tail "$lines" "$app"
      ;;
    *) die "logs: proxy|orchestrator|app" ;;
  esac
}

cmd_start() {
  load_env
  # The orchestrator reconciles on start and (re)starts the active app.
  compose up -d
}

cmd_stop() {
  load_env
  compose stop
  local apps
  apps="$(running_apps)"
  if [[ -n "$apps" ]]; then
    # shellcheck disable=SC2086
    docker stop -t 30 $apps >/dev/null
  fi
  log "stopped (start again with: setup-host.sh start)"
}

cmd_upgrade_edge() {
  load_env
  local ref="${1:-}"
  [[ "$ref" =~ ^[a-z0-9./:-]+@sha256:[a-f0-9]{64}$ ]] || die "upgrade-edge needs a digest-pinned image (repo@sha256:...)"
  docker pull "$ref" >/dev/null
  sed -i "s|^SPARKY_EDGE_IMAGE=.*|SPARKY_EDGE_IMAGE=$ref|" "$EDGE_ENV"
  compose up -d
  log "edge containers now run $ref"
}

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    engine) cmd_engine "$@" ;;
    install) cmd_install "$@" ;;
    import-data) cmd_import_data "$@" ;;
    set-admin-password) cmd_set_admin_password "$@" ;;
    status) cmd_status "$@" ;;
    logs) cmd_logs "$@" ;;
    start) cmd_start "$@" ;;
    stop) cmd_stop "$@" ;;
    upgrade-edge) cmd_upgrade_edge "$@" ;;
    *) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  esac
}

main "$@"
