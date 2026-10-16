#!/usr/bin/env bash
# End-to-end test of the container deployment (#25).
#
# Drives the real stack (proxy, orchestrator, app containers) through the real
# host tooling (deploy/docker/wsl/setup-host.sh) against a local registry, so
# releases flow by digest exactly as in production. Scenarios:
#   1  bootstrap from an imported native data dir
#   2  handover while a checkout is in flight
#   3  persistence: secrets, IP config, DB rows and admin sessions survive
#   4  broken release -> automatic rollback
#   5  update window: queue outside the window, then cancel
#   6  drain timeout -> update postponed, old version keeps serving
#   7  simulated reboot (Docker daemon restart): unattended recovery
#   8  reboot in the middle of an update: reconcile, requeue, finish
#   9  container isolation
#
# Fails loudly; never skips. Needs bash, docker + compose plugin, curl, jq and
# GNU date. Scenarios 7-8 restart the Docker daemon with SPARKY_E2E_RESTART_CMD
# (default: sudo systemctl restart docker), so run this on a disposable host
# (CI) or through e2e-dind.sh, never next to a real Sparky install.
#
# Env: SPARKY_E2E_IMAGE        prebuilt image to test (default: build the repo)
#      SPARKY_E2E_RESTART_CMD  command that restarts the Docker daemon
#      SPARKY_E2E_KEEP=1       leave the stack running afterwards
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
SETUP="$REPO/deploy/docker/wsl/setup-host.sh"
RESTART_CMD="${SPARKY_E2E_RESTART_CMD:-sudo systemctl restart docker}"
REGISTRY_IMAGE="${SPARKY_E2E_REGISTRY_IMAGE:-registry:2@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373}"
REGISTRY_NAME=sparky-e2e-registry
IMG_REPO=localhost:5000/sparky-app
URL=http://127.0.0.1:3930
PASSWORD="e2e-admin-password"
PLC_IP_FIXTURE="10.9.9.9"
# Fake release versions (fixtures only; never real version files).
V_A=9.0.0 V_B=9.1.0 V_BROKEN=9.2.0 V_D=9.3.0

WORK="$(mktemp -d /tmp/sparky-e2e.XXXXXX)"
export SPARKY_EDGE_ENV="$WORK/edge.env"
JAR="$WORK/cookies"
PASSED=0
CODE=""
BODY=""
VARIANTS=()

# ---- output -----------------------------------------------------------------
step() { printf '\n=== %s\n' "$*"; }
ok() {
  PASSED=$((PASSED + 1))
  printf '  ok  %s\n' "$*"
}
die() {
  printf '\nFAIL: %s\n' "$*" >&2
  exit 1
}

diagnostics() {
  echo "--- diagnostics -------------------------------------------------------" >&2
  docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' >&2 || true
  echo "--- edge status" >&2
  curl -sS --max-time 5 "$URL/__edge/status" >&2 || true
  echo >&2
  echo "--- orchestrator log (tail)" >&2
  docker logs --tail 40 sparky-orchestrator >&2 2>&1 || true
  local app
  for app in $(docker ps -a --filter label=sparky.role=app --format '{{.Names}}'); do
    echo "--- $app log (tail)" >&2
    docker logs --tail 25 "$app" >&2 2>&1 || true
  done
}

cleanup() {
  local rc=$?
  set +e
  if [[ $rc -ne 0 ]]; then diagnostics; fi
  if [[ "${SPARKY_E2E_KEEP:-}" == "1" ]]; then
    echo "SPARKY_E2E_KEEP=1: leaving the stack running (work dir $WORK)"
    exit "$rc"
  fi
  docker rm -f sparky-proxy sparky-orchestrator >/dev/null 2>&1
  docker ps -aq --filter label=sparky.role=app | xargs -r docker rm -f >/dev/null 2>&1
  docker ps -aq --filter label=sparky.role=helper | xargs -r docker rm -f >/dev/null 2>&1
  docker rm -f "$REGISTRY_NAME" >/dev/null 2>&1
  for n in sparky-front sparky-control sparky-app-egress sparky-public sparky-orch-egress; do
    docker network rm "$n" >/dev/null 2>&1
  done
  docker volume rm sparky-data sparky-edge-state sparky-route >/dev/null 2>&1
  for v in "${VARIANTS[@]}"; do docker rmi -f "$v" >/dev/null 2>&1; done
  [[ "$WORK" == /tmp/sparky-e2e.* ]] && rm -rf -- "$WORK"
  if [[ $rc -eq 0 ]]; then
    printf '\nPASS: %d checks\n' "$PASSED"
  fi
  exit "$rc"
}

# ---- helpers ------------------------------------------------------------------
wait_until() { # wait_until DESCRIPTION TIMEOUT_S COMMAND...
  local desc=$1 timeout=$2
  shift 2
  local end=$((SECONDS + timeout))
  until "$@"; do
    ((SECONDS < end)) || die "timed out after ${timeout}s waiting for: $desc"
    sleep 0.5
  done
}

healthy() { curl -fsS --max-time 5 "$URL/health" >/dev/null 2>&1; }
edge() { curl -fsS --max-time 5 "$URL/__edge/status" 2>/dev/null || echo '{}'; }
edge_field() { edge | jq -r "$1"; }

wait_phase() { # wait_phase WANTED TIMEOUT_S
  local want=$1 timeout=$2 end=$((SECONDS + $2)) p
  while :; do
    p=$(edge_field .phase)
    [[ "$p" == "$want" ]] && return 0
    case "$p" in
      "done" | failed | rolled-back | canceled | postponed)
        die "update ended '$p' while waiting for '$want': $(edge_field .lastReason)"
        ;;
    esac
    ((SECONDS < end)) || die "timed out after ${timeout}s waiting for phase '$want' (last: '$p')"
    sleep 0.5
  done
}

# call METHOD PATH [JSON] [JAR]  -> sets CODE and BODY (admin cookie + CSRF header)
call() {
  local method=$1 path=$2 data=${3:-} jar=${4:-$JAR}
  local args=(-sS --max-time 30 -o "$WORK/body" -w '%{http_code}' -X "$method" -b "$jar" -H 'X-Requested-By: sparky')
  [[ "$jar" == "$JAR" ]] && args+=(-c "$JAR")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' --data "$data")
  CODE=$(curl "${args[@]}" "$URL$path" 2>/dev/null) || CODE=000
  BODY=$(cat "$WORK/body" 2>/dev/null || true)
}

expect_code() { # expect_code WANTED DESCRIPTION
  [[ "$CODE" == "$1" ]] || die "$2: expected HTTP $1, got $CODE: $BODY"
  ok "$2"
}

set_env() { # set_env KEY VALUE (edge.env)
  if grep -q "^$1=" "$SPARKY_EDGE_ENV"; then
    sed -i "s|^$1=.*|$1=$2|" "$SPARKY_EDGE_ENV"
  else
    echo "$1=$2" >>"$SPARKY_EDGE_ENV"
  fi
}

# Ready = the control API answers the active app's authenticated call (the
# same path the backend uses). Log lines are no proof: a restarted container
# keeps its old logs.
orchestrator_ready() {
  local app
  app=$(active_app)
  [[ -n "$app" ]] || return 1
  docker exec "$app" node -e \
    'fetch(process.env.SPARKY_ORCH_URL + "/v1/status", { headers: { authorization: "Bearer " + process.env.SPARKY_ORCH_TOKEN }, signal: AbortSignal.timeout(2000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' \
    >/dev/null 2>&1
}

apply_env() { # (re)start the edge containers with the current edge.env
  bash "$SETUP" install >/dev/null 2>&1 || die "setup-host.sh install failed"
  wait_until "orchestrator ready" 60 orchestrator_ready
}

active_app() { docker ps --filter label=sparky.role=app --format '{{.Names}}'; }
app_count() { docker ps -a --filter label=sparky.role=app --format '{{.Names}}' | grep -c . || true; }
# The orchestrator records "done" before it removes the old container (so a
# crash in between resolves to the new version); give the removal a moment.
single_app() { [[ $(app_count) == 1 ]]; }
registry_up() { curl -fsS --max-time 2 http://127.0.0.1:5000/v2/ -o /dev/null 2>/dev/null; }

open_window() { # a window around now (UTC), wide enough for the whole run
  echo "$(date -u -d '-1 hour' +%H):00-$(date -u -d '+3 hour' +%H):00"
}

# Build a relabelled release, push it, and print its digest reference.
release() { # release VERSION [DOCKERFILE] [BASE]
  local version=$1 dockerfile=${2:-variant.Dockerfile} base=${3:-$BASE_IMAGE}
  docker build -q -f "$HERE/$dockerfile" --build-arg BASE="$base" --build-arg SPARKY_VERSION="$version" \
    -t "$IMG_REPO:$version" "$HERE" >/dev/null || die "build of $version failed"
  docker push -q "$IMG_REPO:$version" >/dev/null || die "push of $version failed"
  docker inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$IMG_REPO:$version" | grep "^$IMG_REPO@" | head -n1
}

publish() { # publish VERSION DIGEST_REF -> the manifest the orchestrator reads
  docker run --rm --user node -v sparky-edge-state:/state -e V="$1" -e IMG="$2" --entrypoint node "$BASE_IMAGE" \
    -e 'require("fs").writeFileSync("/state/manifest.json", JSON.stringify({ version: process.env.V, image: process.env.IMG }))' \
    || die "could not publish the $1 manifest"
}

env_hashes() {
  docker run --rm -v sparky-data:/data:ro --entrypoint sha256sum "$BASE_IMAGE" /data/backend.env /data/microservice.env
}

checkout_count() {
  call GET /api/checkouts
  [[ "$CODE" == 200 ]] || die "GET /api/checkouts: HTTP $CODE"
  jq 'length' <<<"$BODY"
}

session_valid() { # session_valid JAR
  call GET /api/auth/session "" "$1"
  [[ "$CODE" == 200 ]] && jq -e '.authenticated == true' <<<"$BODY" >/dev/null
}

MON_PID=""
MON_OUT=""
start_checkout() { # an operator checkout whose pull is still running afterwards
  local id=$1
  call POST /api/pull/field '{"field":"user","value":"Alice"}'
  expect_code 200 "checkout $id: operator accepted"
  call POST /api/pull/field '{"field":"project","value":"MO-1001"}'
  expect_code 200 "checkout $id: project accepted"
  call POST /api/pull/field '{"field":"item","value":"SKU-1"}'
  expect_code 200 "checkout $id: item accepted; simulated pull starts"
  MON_OUT="$WORK/monitor-$id.json"
  curl -sS --max-time 300 "$URL/api/pull/monitor/e2e-$id?timeout=240000" >"$MON_OUT" 2>/dev/null &
  MON_PID=$!
}

finish_checkout() { # the held monitor must succeed; then submit and reset like the Checkout page
  wait "$MON_PID" || die "checkout monitor request failed: $(cat "$MON_OUT")"
  jq -e '.success == true' "$MON_OUT" >/dev/null || die "in-flight checkout did not complete: $(cat "$MON_OUT")"
  local qty
  qty=$(jq -r .finalQuantity "$MON_OUT")
  ok "in-flight checkout completed without interruption (quantity $qty)"
  call POST /api/checkouts "$(jq -nc --argjson u "$USER_ID" --argjson p "$PROJECT_ID" --argjson i "$ITEM_ID" --argjson q "$qty" \
    '{user_id: $u, project_id: $p, item_id: $i, quantity: $q}')"
  expect_code 201 "checkout recorded"
  call POST /api/pull/reset '{}'
  expect_code 200 "cart reset to idle"
}

# ---- preconditions --------------------------------------------------------------
trap cleanup EXIT

step "0. Preconditions and release fixtures"
for tool in docker curl jq; do command -v "$tool" >/dev/null || die "missing tool: $tool"; done
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"
date -u -d '+1 hour' +%H >/dev/null 2>&1 || die "GNU date is required"
if docker volume inspect sparky-data >/dev/null 2>&1 ||
  docker ps -a --format '{{.Names}}' | grep -qE '^sparky-(proxy|orchestrator|app-)'; then
  die "refusing to run: this Docker host already has a Sparky deployment (sparky-data volume or sparky-* containers). Use a disposable host or e2e-dind.sh."
fi
ok "tools present; no existing Sparky deployment on this host"

BASE_IMAGE="${SPARKY_E2E_IMAGE:-}"
if [[ -z "$BASE_IMAGE" ]]; then
  BASE_IMAGE=sparky-app:e2e-base
  echo "  building $BASE_IMAGE from $REPO ..."
  docker build -q --build-arg SPARKY_VERSION=0.0.0-e2e -t "$BASE_IMAGE" "$REPO" >/dev/null || die "image build failed"
fi
docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || die "image $BASE_IMAGE not found"

docker run -d --name "$REGISTRY_NAME" --restart unless-stopped -p 127.0.0.1:5000:5000 "$REGISTRY_IMAGE" >/dev/null ||
  die "could not start the local registry on 127.0.0.1:5000"
wait_until "local registry" 30 registry_up
# Tags are recorded here: release() runs in a subshell and cannot append.
VARIANTS=("$IMG_REPO:$V_A" "$IMG_REPO:$V_B" "$IMG_REPO:$V_BROKEN" "$IMG_REPO:$V_D")
REF_A=$(release "$V_A")
REF_B=$(release "$V_B")
REF_BROKEN=$(release "$V_BROKEN" broken.Dockerfile "$IMG_REPO:$V_B")
REF_D=$(release "$V_D")
[[ -n "$REF_A" && -n "$REF_B" && -n "$REF_BROKEN" && -n "$REF_D" ]] || die "could not resolve release digests"
ok "releases $V_A, $V_B, $V_BROKEN (broken) and $V_D pushed and pinned by digest"

# ---- 1. bootstrap ---------------------------------------------------------------
step "1. Bootstrap from an imported native data dir"
NATIVE="$WORK/native"
mkdir -p "$NATIVE" "$WORK/backups"
chmod 777 "$NATIVE" "$WORK/backups"
HASH=$(docker run --rm -e PW="$PASSWORD" --entrypoint node "$BASE_IMAGE" \
  -e 'import("/app/backend/src/services/auth/crypto.js").then((m) => console.log(m.hashPassword(process.env.PW)))')
BRIDGE_TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
cat >"$NATIVE/backend.env" <<EOF
ADMIN_PASSWORD_HASH=$HASH
SESSION_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
BRIDGE_TOKEN=$BRIDGE_TOKEN
EOF
cat >"$NATIVE/microservice.env" <<EOF
PLC_MODE=sim
PLC_IP=$PLC_IP_FIXTURE
BRIDGE_TOKEN=$BRIDGE_TOKEN
SIM_AUTO_PULL=true
SIM_AUTO_PULL_DELAY_MS=1000
SIM_DEFAULT_TARGET=100
SIM_DEFAULT_RATE=4
SIM_TICK_MS=1000
EOF
chmod 644 "$NATIVE"/*.env
# A native-style database with reference data, created by the app's own schema code.
docker run --rm --user node -v "$NATIVE":/out -e SPARKY_DATA_DIR=/tmp/scratch -e NODE_ENV=test \
  -e SESSION_SECRET=fixture-builder-only --entrypoint node "$BASE_IMAGE" \
  --input-type=module -e '
    import Database from "/app/backend/node_modules/better-sqlite3/lib/index.js";
    import { createTables } from "/app/backend/src/init/db.init.js";
    import { runMigrations } from "/app/backend/src/init/migrations.js";
    const db = new Database("/out/prod.sqlite");
    createTables(db);
    runMigrations(db);
    db.prepare("INSERT INTO users (name, user_type, status) VALUES (?, ?, ?)").run("Alice", "operator", "ACTIVE");
    db.prepare("INSERT INTO projects (project_number, name, status) VALUES (?, ?, ?)").run("MO-1001", "E2E Project", "ACTIVE");
    db.prepare("INSERT INTO items (sku, name) VALUES (?, ?)").run("SKU-1", "E2E Cable");
    db.close();' >/dev/null || die "could not create the fixture database"

cp "$REPO/deploy/docker/test/edge.test.env" "$SPARKY_EDGE_ENV"
set_env SPARKY_EDGE_IMAGE "$REF_A"
set_env SPARKY_APP_IMAGE "$REF_A"
set_env SPARKY_IMAGE_REPO "$IMG_REPO"
set_env SPARKY_UPDATE_MANIFEST_URL "file:///state/manifest.json"
set_env SPARKY_UPDATE_WINDOW "$(open_window)"
set_env SPARKY_SCHED_TICK_MS 2000
set_env SPARKY_VERIFY_HOLD_MS 3000
set_env SPARKY_BACKUP_HOST_DIR "$WORK/backups"

bash "$SETUP" import-data "$NATIVE" >/dev/null || die "import-data failed"
ok "native data dir imported into the sparky-data volume"
ENV_HASHES_BEFORE=$(env_hashes)
docker volume create sparky-edge-state >/dev/null
publish "$V_B" "$REF_B"
apply_env
wait_until "app serving through the proxy" 120 healthy
ok "proxy -> app healthy; orchestrator bootstrapped $(active_app)"
APP_A=$(active_app)
[[ "$APP_A" == sparky-app-$V_A-* ]] || die "unexpected bootstrap container '$APP_A'"

call POST /api/auth/login "{\"password\":\"$PASSWORD\"}"
expect_code 200 "admin login with the imported password"
cp "$JAR" "$WORK/cookies-issued-under-A"
call GET /api/system/info
[[ $(jq -r .deployment <<<"$BODY") == container ]] || die "info.deployment is not container: $BODY"
ok "backend reports the container deployment"
call GET /api/table_data
USER_ID=$(jq '.users[] | select(.name == "Alice") | .user_id' <<<"$BODY")
PROJECT_ID=$(jq '.projects[] | select(.project_number == "MO-1001") | .project_id' <<<"$BODY")
ITEM_ID=$(jq '.items[] | select(.sku == "SKU-1") | .item_id' <<<"$BODY")
[[ -n "$USER_ID" && -n "$PROJECT_ID" && -n "$ITEM_ID" ]] || die "imported reference data missing: $BODY"
ok "imported database is live (user, project and item present)"

# ---- 2. handover with an in-flight checkout ---------------------------------------
step "2. Handover $V_A -> $V_B while a checkout is in flight"
start_checkout 1
call POST /api/system/update
expect_code 202 "update queued (window open, runs now)"
wait_phase draining 90
ok "old version is draining"
call POST /api/pull/field '{"field":"user","value":"Alice"}'
if [[ "$CODE" != 503 ]] || ! jq -e '.updating == true' <<<"$BODY" >/dev/null; then
  die "new checkout during drain: expected 503 updating, got $CODE: $BODY"
fi
ok "new checkouts are refused during the drain (503 updating)"
finish_checkout
wait_phase "done" 180
wait_until "old container removed" 60 single_app
APP_B=$(active_app)
[[ "$APP_B" == sparky-app-$V_B-* ]] || die "active app after handover is '$APP_B'"
ok "handover done: $APP_B active, $APP_A removed"
wait_until "new version serving" 60 healthy
CHECKOUTS=$(checkout_count)
[[ "$CHECKOUTS" == 1 ]] || die "expected 1 recorded checkout, found $CHECKOUTS"
ok "checkout taken during the handover is in the database"

# ---- 3. persistence ---------------------------------------------------------------
step "3. Persistence across the handover"
[[ "$(env_hashes)" == "$ENV_HASHES_BEFORE" ]] || die "backend.env/microservice.env changed during the update"
ok "backend.env and microservice.env byte-identical (admin hash, secrets, PLC_IP)"
session_valid "$WORK/cookies-issued-under-A" || die "admin session issued under $V_A is not valid under $V_B"
ok "admin session issued under $V_A still valid under $V_B"
call POST /api/auth/login "{\"password\":\"$PASSWORD\"}"
expect_code 200 "same admin password works on $V_B"
APP_ENV=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP_B")
for key in ADMIN_PASSWORD_HASH SESSION_SECRET BRIDGE_TOKEN EMAIL_PASS EMAIL_USER PLC_IP PLC_MODE; do
  if grep -q "^$key=" <<<"$APP_ENV"; then die "app container env carries $key"; fi
done
if grep -qF "$PLC_IP_FIXTURE" <<<"$APP_ENV" || grep -qF "$HASH" <<<"$APP_ENV"; then
  die "app container env carries device IP config or the admin hash"
fi
ok "app container env holds no secrets or device IP config"

# ---- 4. broken release -> rollback --------------------------------------------------
step "4. Broken release $V_BROKEN -> automatic rollback"
publish "$V_BROKEN" "$REF_BROKEN"
call POST /api/system/update
expect_code 202 "update to the broken release queued"
end=$((SECONDS + 240))
while [[ "$(edge_field .phase)" != "rolled-back" ]]; do
  p=$(edge_field .phase)
  [[ "$p" == "done" || "$p" == failed || "$p" == canceled ]] && die "broken release ended '$p': $(edge_field .lastReason)"
  ((SECONDS < end)) || die "timed out waiting for the rollback (last: $p)"
  sleep 0.5
done
REASON=$(edge_field .lastReason)
[[ "$REASON" == *"Rolled back to $V_B."* ]] || die "unexpected rollback reason: $REASON"
[[ "$REASON" != *FAILED* ]] || die "DB snapshot restore failed: $REASON"
ok "rolled back: $REASON"
wait_until "previous version serving again" 90 healthy
[[ "$(active_app)" == "$APP_B" ]] || die "active app after rollback is '$(active_app)', expected $APP_B"
[[ $(app_count) == 1 ]] || die "broken container was not removed"
ok "$APP_B serving again; broken container removed"
[[ "$(checkout_count)" == "$CHECKOUTS" ]] || die "checkout rows changed across the rollback"
session_valid "$JAR" || die "admin session lost across the rollback"
ok "database rows and admin session intact after rollback"

# ---- 5. update window: queue + cancel ------------------------------------------------
step "5. Update window: queue outside the window, then cancel"
CLOSED_WINDOW="$(date -u -d '+2 hour' +%H):00-$(date -u -d '+3 hour' +%H):00"
EXPECTED_NOT_BEFORE="$(date -u -d '+2 hour' +%Y-%m-%dT%H:00:00.000Z)"
set_env SPARKY_UPDATE_WINDOW "$CLOSED_WINDOW"
apply_env
publish "$V_D" "$REF_D"
call POST /api/system/update
expect_code 202 "update requested outside the window"
[[ $(jq -r .state <<<"$BODY") == queued && $(jq -r .notBefore <<<"$BODY") == "$EXPECTED_NOT_BEFORE" ]] ||
  die "expected queued until $EXPECTED_NOT_BEFORE, got: $BODY"
ok "queued until the window opens ($EXPECTED_NOT_BEFORE, window $CLOSED_WINDOW UTC)"
sleep 5
[[ "$(edge_field .phase)" == queued && "$(active_app)" == "$APP_B" ]] || die "queued update started outside the window"
ok "nothing runs while the window is closed"
call DELETE /api/system/update
expect_code 200 "queued update canceled"
[[ "$(edge_field .phase)" == canceled ]] || die "status after cancel: $(edge_field .phase)"

# ---- 6. drain timeout -> postpone ------------------------------------------------------
step "6. Drain timeout: postpone while a checkout is still running"
set_env SPARKY_UPDATE_WINDOW "$(open_window)"
set_env SPARKY_DRAIN_TIMEOUT_MS 5000
apply_env
start_checkout 2
call POST /api/system/update
expect_code 202 "update queued"
end=$((SECONDS + 120))
until [[ "$(edge_field .phase)" == postponed ]]; do
  p=$(edge_field .phase)
  [[ "$p" == "done" || "$p" == failed || "$p" == rolled-back ]] && die "expected a postponement, got '$p'"
  ((SECONDS < end)) || die "timed out waiting for the postponement (last: $p)"
  sleep 0.5
done
REASON=$(edge_field .lastReason)
[[ "$REASON" == *"still in progress"* ]] || die "unexpected postpone reason: $REASON"
NOT_BEFORE=$(date -u -d "$(edge_field .notBefore)" +%s)
(($(date -u +%s) + 600 < NOT_BEFORE)) || die "postponed retry is not ~15 min out: $(edge_field .notBefore)"
ok "postponed: $REASON (retry at $(edge_field .notBefore))"
[[ "$(active_app)" == "$APP_B" && $(app_count) == 1 ]] || die "standby container left behind after postponing"
healthy || die "old version stopped serving after the postponement"
ok "$APP_B kept serving; standby container removed"
finish_checkout
docker restart sparky-orchestrator >/dev/null
wait_until "orchestrator back" 60 orchestrator_ready
[[ "$(edge_field .phase)" == postponed ]] || die "postponed update lost across an orchestrator restart"
ok "postponed update persists across an orchestrator restart"
call DELETE /api/system/update
expect_code 200 "postponed update canceled"

# ---- 7. simulated reboot --------------------------------------------------------------
step "7. Simulated reboot: Docker daemon restart, unattended recovery"
CHECKOUTS=$(checkout_count)
echo "  restarting the Docker daemon: $RESTART_CMD"
eval "$RESTART_CMD" || die "daemon restart command failed"
t0=$SECONDS
wait_until "stack back after the restart" 60 healthy
ok "app serving again $((SECONDS - t0))s after the daemon came back, with no manual steps"
for c in sparky-proxy sparky-orchestrator; do
  [[ "$(docker inspect -f '{{.State.Running}}' "$c")" == true ]] || die "$c is not running after the restart"
done
[[ "$(active_app)" == "$APP_B" ]] || die "active app after restart is '$(active_app)'"
[[ $(docker ps --filter label=sparky.role=app --format '{{.Names}}' | grep -c .) == 1 ]] || die "unexpected app containers running after restart"
ok "proxy, orchestrator and $APP_B restarted by Docker; no stale app container"
[[ "$(checkout_count)" == "$CHECKOUTS" ]] || die "checkout rows changed across the restart"
session_valid "$JAR" || die "admin session lost across the restart"
ok "database and admin session survived the restart"

# ---- 8. reboot during an update ------------------------------------------------------------
step "8. Reboot in the middle of an update"
set_env SPARKY_DRAIN_TIMEOUT_MS 600000
apply_env
start_checkout 3
call POST /api/system/update
expect_code 202 "update to $V_D queued"
wait_phase draining 90
STANDBY=$(docker ps --filter "name=sparky-app-$V_D-" --format '{{.Names}}')
[[ -n "$STANDBY" ]] || die "no standby container during the drain"
ok "draining with standby $STANDBY; restarting the daemon now"
eval "$RESTART_CMD" || die "daemon restart command failed"
wait "$MON_PID" 2>/dev/null || true # the in-flight request dies with the reboot
wait_until "app serving after the mid-update restart" 90 healthy
docker logs sparky-orchestrator 2>&1 | grep -q "reconcile: remove $STANDBY" ||
  die "orchestrator did not reconcile away the interrupted standby"
ok "orchestrator reconciled the interrupted update (removed $STANDBY)"
wait_phase "done" 240
wait_until "old container removed" 60 single_app
[[ "$(edge_field .attempts)" == 2 ]] || die "expected the update to complete on its 2nd attempt, got $(edge_field .attempts)"
APP_D=$(active_app)
[[ "$APP_D" == sparky-app-$V_D-* && $(app_count) == 1 ]] || die "after the requeued update the active app is '$APP_D'"
ok "requeued update completed on the 2nd attempt: $APP_D active"
[[ "$(checkout_count)" == "$CHECKOUTS" ]] || die "checkout rows changed"
[[ "$(env_hashes)" == "$ENV_HASHES_BEFORE" ]] || die "env files changed"
ok "database and env files intact after the interrupted update"

# ---- 9. isolation --------------------------------------------------------------------------
step "9. Container isolation"
if docker exec sparky-proxy ls /var/run/docker.sock >/dev/null 2>&1; then die "proxy can see docker.sock"; fi
[[ "$(docker inspect -f '{{range .Mounts}}{{.Destination}}:{{.RW}} {{end}}' sparky-proxy)" == "/route:false " ]] ||
  die "proxy mounts: $(docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' sparky-proxy)"
docker exec sparky-proxy node -e \
  'fetch("http://sparky-orchestrator:3200/v1/status",{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(1),()=>process.exit(0))' ||
  die "proxy can reach the orchestrator control API"
ok "proxy: no docker.sock, only /route read-only, cannot reach the orchestrator"
[[ "$(docker inspect -f '{{json .HostConfig.PortBindings}}' sparky-orchestrator)" == "{}" ]] || die "orchestrator publishes ports"
ok "orchestrator publishes no ports"
if docker exec "$APP_D" ls /var/run/docker.sock >/dev/null 2>&1; then die "app can see docker.sock"; fi
if docker exec "$APP_D" touch /app/tamper >/dev/null 2>&1; then die "app rootfs is writable"; fi
docker exec "$APP_D" node -e \
  'fetch("http://sparky-orchestrator:3200/v1/status").then(r=>process.exit(r.status===401?0:1),()=>process.exit(1))' ||
  die "orchestrator accepted an unauthenticated call"
ok "app: no docker.sock, read-only rootfs, orchestrator rejects calls without its token"
