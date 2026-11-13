# viafrei-database: the baseline, the migrations after it, the
# migrate/partitions/role steps and the owner-only diagnostics interface in
# one small image.
#
#   docker run IMAGE                 serve (default): migrate, partitions ensure,
#                                    role passwords, then /healthz + /ready on
#                                    8080 and the interface on 8090 (DB_HOST set)
#   docker run IMAGE migrate|check|head|status|partitions ensure|analyze T|lint|export-migrations|version
#
# Runs as uid 10001 with a read-only root file system: it writes nothing but
# psql's own temporaries, and HOME points at /tmp (mount a tmpfs there).
# Both stages name the base image literally, pinned by digest, so Dependabot
# (docker ecosystem) proposes the update; CI runs the same Node version.
# The apk packages are pinned to exact versions: a rebuild after Alpine
# replaces one fails loudly instead of picking up an unreviewed client.

FROM node:26.13.0-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:26.13.0-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216
# psql runs the migrations (\gexec and `create index concurrently` need it);
# tini reaps it and forwards SIGTERM. The base image's npm and npx are removed:
# the service never runs them, and npm's own bundled dependencies were the
# only HIGH findings Trivy reported on this image. apk stays (the image scan
# reads its database).
RUN apk add --no-cache tini=0.19.0-r3 postgresql16-client=16.16-r0 \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
 && addgroup -g 10001 -S viafrei && adduser -u 10001 -S -G viafrei -H -h /tmp viafrei
WORKDIR /app
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY package.json ./
# db/ holds the baseline, the migrations after it and the role SQL (.dockerignore lets only those in).
COPY db ./db
ARG VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="viafrei-database" \
      org.opencontainers.image.description="The ViaFrei database schema and the service that applies it" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/mavrovde/viafrei-database" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"
ENV NODE_ENV=production HOME=/tmp PSQL_HISTORY=/dev/null APP_VERSION=${VERSION} APP_GIT_SHA=${GIT_SHA}
USER 10001:10001
EXPOSE 8080 8090
ENTRYPOINT ["/sbin/tini", "--", "node", "/app/dist/cli.js"]
CMD ["serve"]
