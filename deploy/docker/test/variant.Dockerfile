# E2E fixture (#25): the base image relabelled as another release version.
# Same code, different config -> a different digest, which is all the update
# flow needs to tell releases apart. Never published.
ARG BASE
FROM ${BASE}
ARG SPARKY_VERSION
LABEL org.opencontainers.image.version="${SPARKY_VERSION}"
