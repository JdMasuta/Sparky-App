# E2E fixture (#25): a release that passes standby preflight but whose backend
# crashes right after it starts, i.e. only AFTER the handover has committed.
# Exercises the real post-commit rollback (DB snapshot restore + old version
# restarted). Never published.
ARG BASE
FROM ${BASE}
ARG SPARKY_VERSION
LABEL org.opencontainers.image.version="${SPARKY_VERSION}"
USER root
RUN printf '\nthrow new Error("deliberately broken release (e2e rollback test)");\n' >> /app/backend/src/server.js
USER node
