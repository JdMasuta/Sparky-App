# syntax=docker/dockerfile:1
# Sparky Cart image (#25): frontend + backend + PLC bridge, plus the container
# supervisor and edge roles. One image, role chosen by command:
#   app (default)  node deploy/container/entrypoint.mjs
#   proxy          node deploy/edge/edge.mjs --role=proxy
#   orchestrator   node deploy/edge/edge.mjs --role=orchestrator
# The image holds code only. The DB, secrets and device configuration live in
# the data volume mounted at /data (see SECURITY.md). /state and /route are
# mount points for the orchestrator's state and the proxy route volumes; they
# exist here, owned by node, so fresh named volumes inherit that ownership.

# Pinned by digest; Node version matches CI and the portable runtime.
ARG NODE_IMAGE=node:23.6.0-bookworm-slim@sha256:66a57ce3fb719590aed5a22776e4de507ab4c0f445e89a761fc6847573103df3

# ---- frontend build (vite outDir is ../backend/src/public) --------------------
FROM ${NODE_IMAGE} AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --include=dev
COPY frontend/ ./
RUN mkdir -p /src/backend/src && npm run build

# ---- production dependencies (better-sqlite3 may need to compile) -------------
FROM ${NODE_IMAGE} AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY backend/package.json backend/package-lock.json backend/
COPY microservice/package.json microservice/package-lock.json microservice/
RUN npm --prefix backend ci --omit=dev \
 && npm --prefix microservice ci --omit=dev

# ---- runtime -------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG SPARKY_VERSION=0.0.0-dev
ARG SPARKY_REVISION=unknown
LABEL org.opencontainers.image.title="sparky-app" \
      org.opencontainers.image.source="https://github.com/JdMasuta/Sparky-App" \
      org.opencontainers.image.version="${SPARKY_VERSION}" \
      org.opencontainers.image.revision="${SPARKY_REVISION}"

# No package managers at runtime: smaller attack surface and no bundled
# npm/yarn CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && mkdir -p /data /backups /state /route \
 && chown node:node /data /backups /state /route

WORKDIR /app
COPY package.json ./
COPY backend/package.json backend/
COPY backend/src backend/src
COPY backend/scripts backend/scripts
COPY --from=deps /src/backend/node_modules backend/node_modules
COPY --from=frontend /src/backend/src/public backend/src/public
COPY microservice/package.json microservice/
COPY microservice/src microservice/src
COPY --from=deps /src/microservice/node_modules microservice/node_modules
COPY deploy/ deploy/

ENV NODE_ENV=production \
    SPARKY_DATA_DIR=/data \
    SPARKY_DB_FILE=prod.sqlite \
    PORT=3000 \
    BRIDGE_HOST=127.0.0.1 \
    BRIDGE_PORT=8000

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "deploy/container/healthcheck.mjs"]
CMD ["node", "deploy/container/entrypoint.mjs"]
