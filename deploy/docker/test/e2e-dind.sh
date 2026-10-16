#!/usr/bin/env bash
# Run e2e.sh inside a disposable Docker-in-Docker sandbox (#25).
#
# e2e.sh restarts the Docker daemon to simulate reboots. On a developer machine
# that would also stop every other container, so this wrapper gives the test
# its own daemon: a privileged docker:dind container whose dockerd can be
# restarted freely. CI runners are disposable and run e2e.sh directly.
#
#   deploy/docker/test/e2e-dind.sh            build the repo image, then test it
#   SPARKY_E2E_IMAGE=tag e2e-dind.sh          test an existing image
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
DIND_IMAGE="${SPARKY_E2E_DIND_IMAGE:-docker:29-dind@sha256:0b6d18a4a222e71c88be6034926b4f6cde2fc33c2218643d03ccfddc65995470}"
NAME="sparky-e2e-dind-$$"
IMAGE="${SPARKY_E2E_IMAGE:-}"

cleanup() { docker rm -f -v "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [[ -z "$IMAGE" ]]; then
  IMAGE=sparky-app:e2e-base
  echo "building $IMAGE from $REPO ..."
  docker build -q --build-arg SPARKY_VERSION=0.0.0-e2e -t "$IMAGE" "$REPO" >/dev/null
fi

echo "starting sandbox $NAME ..."
docker run -d --privileged --name "$NAME" -e DOCKER_TLS_CERTDIR= -v "$REPO":/repo:ro \
  --entrypoint sleep "$DIND_IMAGE" infinity >/dev/null
docker exec "$NAME" apk add --no-cache -q bash curl jq coreutils >/dev/null

# sparky-dockerd start|restart: (re)start the sandbox daemon. A daemon restart
# stops every container and restarts those with restart policies, like a reboot.
docker exec -i "$NAME" sh -c 'cat >/usr/local/bin/sparky-dockerd && chmod 0755 /usr/local/bin/sparky-dockerd' <<'EOF'
#!/bin/sh
set -e
stop() {
  pid=$(pidof dockerd || true)
  [ -n "$pid" ] || return 0
  kill -TERM $pid
  i=0
  while pidof dockerd >/dev/null; do
    i=$((i + 1)); [ $i -le 240 ] || { echo "dockerd did not stop" >&2; exit 1; }
    sleep 0.5
  done
}
start() {
  nohup dockerd-entrypoint.sh dockerd >>/var/log/dockerd.log 2>&1 &
  i=0
  until docker info >/dev/null 2>&1; do
    i=$((i + 1)); [ $i -le 240 ] || { echo "dockerd did not start" >&2; tail -n 30 /var/log/dockerd.log >&2; exit 1; }
    sleep 0.5
  done
}
case "$1" in
  start) start ;;
  restart) stop; start ;;
  *) echo "usage: sparky-dockerd start|restart" >&2; exit 2 ;;
esac
EOF
docker exec "$NAME" sparky-dockerd start

echo "loading $IMAGE into the sandbox ..."
docker save "$IMAGE" | docker exec -i "$NAME" docker load -q >/dev/null

docker exec -e SPARKY_E2E_IMAGE="$IMAGE" -e SPARKY_E2E_RESTART_CMD="sparky-dockerd restart" \
  "$NAME" bash /repo/deploy/docker/test/e2e.sh
