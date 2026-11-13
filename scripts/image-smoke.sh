#!/usr/bin/env bash
# Image smoke: build the image (unless IMAGE is given), then prove the claims
# the image makes, against a throwaway PostGIS on a private docker network:
#
#   * it runs as a non-root uid, with a read-only root file system, no
#     capabilities and no new privileges;
#   * it ships no npm and no npx (apk stays: the image scan reads its database);
#   * `help`, `version` and `export-migrations` work without a database;
#   * `serve` answers /healthz at once and /ready with `READY <head>` once it
#     has migrated an empty database, and `head` agrees;
#   * the interface answers the allow-listed address and refuses another one
#     with 403 and an empty body; a wrong Host gets 421.
#
# Every container and the network are removed on every exit path.
# Usage: scripts/image-smoke.sh            (builds viafrei-database:smoke)
#        IMAGE=ref scripts/image-smoke.sh  (uses an image that exists)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POSTGIS="${SMOKE_POSTGIS_IMAGE:-postgis/postgis:16-3.4@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5}"
CURL_IMAGE="${SMOKE_CURL_IMAGE:-curlimages/curl:8.17.0@sha256:935d9100e9ba842cdb060de42472c7ca90cfe9a7c96e4dacb55e79e560b3ff40}"
TAG="smoke-$$"
NET="vfdb-$TAG"
IMAGE="${IMAGE:-}"
fails=0
ok() { printf '  ✓ %s\n' "$1"; }
bad() { printf '  ✗ %s\n' "$1"; fails=$((fails + 1)); }

cleanup() {
  docker rm -f "vfdb-app-$TAG" "vfdb-pg-$TAG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v docker >/dev/null || { echo "✗ docker is not on PATH — the smoke cannot run" >&2; exit 2; }
if [ -z "$IMAGE" ]; then
  IMAGE="viafrei-database:smoke"
  docker build -q -t "$IMAGE" "$ROOT" >/dev/null
fi
# The image's own answer for its schema head (the baseline's or the newest file's), no database needed.
HEAD_EXPECTED="$(docker run --rm --read-only --tmpfs /tmp "$IMAGE" version | sed -n 's/^viafrei-database [^ ]* schema-head \([0-9][0-9]*\)$/\1/p')"
[ -n "$HEAD_EXPECTED" ] && [ "$HEAD_EXPECTED" -ge 1 ] || { echo "✗ the image reports no schema head — nothing to smoke" >&2; exit 2; }
EXPORTED="$(docker run --rm --read-only --tmpfs /tmp "$IMAGE" export-migrations | tar -t | grep -cE '^db/(baseline/[0-9]{4}_baseline|migrations/[0-9]{4}_[^/]*)\.sql$' || true)"

HARDEN=(--read-only --tmpfs /tmp:rw,size=64m --cap-drop ALL --security-opt no-new-privileges)

uid="$(docker run --rm "${HARDEN[@]}" --entrypoint id "$IMAGE" -u)"
[ "$uid" != "0" ] && ok "runs as uid $uid, not root" || bad "runs as root"
docker run --rm "${HARDEN[@]}" "$IMAGE" help | grep -q '^usage: viafrei-db' && ok "help" || bad "help"
# `command -v` prints the path of whatever it finds; only the end marker means
# neither exists (a container that did not run prints no marker at all).
pm="$(docker run --rm "${HARDEN[@]}" --entrypoint sh "$IMAGE" -c 'command -v npm; command -v npx; echo __checked__' || true)"
if [ "$pm" = "__checked__" ]; then ok "ships no npm or npx"
else bad "ships npm or npx, which the service never runs (or the check did not run): $(printf '%s' "$pm" | tr '\n' ' ')"; fi
[ "$EXPORTED" -ge 1 ] && ok "export-migrations carries $EXPORTED schema file(s); version says head $HEAD_EXPECTED" || bad "export-migrations carries no schema file"

docker network create "$NET" >/dev/null
docker run -d --name "vfdb-pg-$TAG" --network "$NET" -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=viafrei "$POSTGIS" >/dev/null
for _ in $(seq 1 90); do docker exec "vfdb-pg-$TAG" pg_isready -h 127.0.0.1 -q 2>/dev/null && break; sleep 1; done
docker exec "vfdb-pg-$TAG" psql -U postgres -h 127.0.0.1 -d viafrei -qc 'create extension if not exists postgis' >/dev/null

SUBNET="$(docker network inspect -f '{{(index .IPAM.Config 0).Subnet}}' "$NET")"
TOKEN_SHA="$(printf '%s' 'smoke-owner-token-0123456789' | sha256sum | cut -c1-64)"
docker run -d --name "vfdb-app-$TAG" --network "$NET" "${HARDEN[@]}" \
  -e DATABASE_URL="postgresql://postgres:smoke@vfdb-pg-$TAG:5432/viafrei" \
  -e DB_HOST="vfdb-app-$TAG" -e DB_ALLOW_CIDR="$SUBNET" \
  -e DB_OWNER_TOKEN_SHA256="$TOKEN_SHA" -e DB_SESSION_SECRET="smoke-session-secret-0123456789abcdef" \
  "$IMAGE" serve >/dev/null

probe() { docker run --rm --network "$NET" "$CURL_IMAGE" -s -o /dev/stderr -w '%{http_code}' "$@" 2>/dev/null; }
body() { docker run --rm --network "$NET" "$CURL_IMAGE" -s "$@" 2>/dev/null; }
APP="http://vfdb-app-$TAG"

[ "$(probe "$APP:8080/healthz")" = "200" ] && ok "/healthz 200" || bad "/healthz"
ready=""
for _ in $(seq 1 600); do
  ready="$(body "$APP:8080/ready" || true)"
  case "$ready" in READY*) break ;; esac
  docker ps -q --filter "name=^vfdb-app-$TAG$" | grep -q . || { bad "serve exited: $(docker logs --tail 20 "vfdb-app-$TAG" 2>&1)"; break; }
  sleep 1
done
[ "$ready" = "READY $HEAD_EXPECTED" ] && ok "/ready says READY $HEAD_EXPECTED after migrating an empty database" || bad "/ready said '$ready', expected 'READY $HEAD_EXPECTED'"
docker exec "vfdb-app-$TAG" node /app/dist/cli.js head | grep -qx "READY $HEAD_EXPECTED" && ok "head agrees" || bad "head disagrees"
docker exec "vfdb-app-$TAG" node /app/dist/cli.js check >/dev/null && ok "check passes" || bad "check fails"

[ "$(probe "$APP:8090/")" = "200" ] && ok "interface serves the allow-listed network" || bad "interface refused the allow-listed network"
[ "$(probe -H 'Host: other.example' "$APP:8090/")" = "421" ] && ok "a wrong Host gets 421" || bad "a wrong Host was not refused"
# A peer outside the allow-list: a second network the app is attached to.
docker network create "$NET-out" >/dev/null
docker network connect "$NET-out" "vfdb-app-$TAG"
OUT_IP="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$NET-out\").IPAddress}}" "vfdb-app-$TAG")"
outside="$(docker run --rm --network "$NET-out" "$CURL_IMAGE" -s -D - -o /dev/null -H "Host: vfdb-app-$TAG" "http://$OUT_IP:8090/" 2>/dev/null | tr -d '\r')"
docker network disconnect "$NET-out" "vfdb-app-$TAG" >/dev/null; docker network rm "$NET-out" >/dev/null
printf '%s' "$outside" | head -1 | grep -q ' 403' && printf '%s' "$outside" | grep -qi '^content-length: 0$' && ok "an address outside the allow-list gets 403 with an empty body" || bad "an outside address was not refused silently"

[ "$fails" -eq 0 ] && { echo "✓ image smoke: all checks passed ($IMAGE)"; exit 0; }
echo "✗ image smoke: $fails check(s) failed"; docker logs --tail 40 "vfdb-app-$TAG" 2>&1 | tail -40; exit 1
