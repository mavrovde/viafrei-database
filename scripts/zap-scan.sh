#!/usr/bin/env bash
# DAST: OWASP ZAP's baseline scan against the interface of the BUILT image,
# serving a throwaway PostGIS on a private docker network. Nothing here
# reaches a real database or a public host.
#
# ZAP's own network is the allow-listed one, so it sees the page an owner
# sees (diagnostics, the sign-in form); the actions behind the sign-in are
# covered by the unit tests. Findings go to zap-report/ (HTML, JSON, SARIF).
# The verdict (scripts/zap-verdict.ts): every alert ZAP raises, at any risk
# level, fails the run unless scripts/zap-rules.tsv marks its rule IGNORE with
# a reason; ZAP's own FAIL (exit 1) or error (exit 3) fails it too.
# Exit 0 pass, 1 an alert, 2 the scan could not run (no READY, no report).
# Usage: IMAGE=viafrei-database:ci scripts/zap-scan.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:?IMAGE must name a built image}"
ZAP_IMAGE="zaproxy/zap-stable:20261016@sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6"
POSTGIS="postgis/postgis:16-3.4@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5"
NET="vfdb-zap-$$"
OUT="$ROOT/zap-report"
mkdir -p "$OUT"

cleanup() {
  docker rm -f vfdb-zap-app vfdb-zap-pg vfdb-zap >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name vfdb-zap-pg --network "$NET" -e POSTGRES_PASSWORD=zap -e POSTGRES_DB=viafrei "$POSTGIS" >/dev/null
for _ in $(seq 1 90); do docker exec vfdb-zap-pg pg_isready -h 127.0.0.1 -q 2>/dev/null && break; sleep 1; done
docker exec vfdb-zap-pg psql -U postgres -h 127.0.0.1 -d viafrei -qc 'create extension if not exists postgis' >/dev/null
SUBNET="$(docker network inspect -f '{{(index .IPAM.Config 0).Subnet}}' "$NET")"
docker run -d --name vfdb-zap-app --network "$NET" --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  -e DATABASE_URL="postgresql://postgres:zap@vfdb-zap-pg:5432/viafrei" \
  -e DB_HOST=vfdb-zap-app -e DB_ALLOW_CIDR="$SUBNET" \
  -e DB_OWNER_TOKEN_SHA256="$(printf '%s' 'zap-owner-token-0123456789' | sha256sum | cut -c1-64)" \
  -e DB_SESSION_SECRET="zap-session-secret-0123456789abcdef" \
  "$IMAGE" serve >/dev/null
# The interface answers before the database is ready (the page shows NOT READY); wait for READY so the scan sees the full page.
ready=false
for _ in $(seq 1 600); do
  if docker exec vfdb-zap-app node -e 'fetch("http://127.0.0.1:8080/ready").then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))'; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || { echo "✗ the interface never answered READY within 600 s — the scan did not run" >&2; docker logs --tail 20 vfdb-zap-app >&2 || true; exit 2; }

set +e
docker run --name vfdb-zap --network "$NET" --entrypoint sh "$ZAP_IMAGE" -c \
  'mkdir -p /zap/wrk && cat >/zap/wrk/rules.tsv && exec zap-baseline.py -t http://vfdb-zap-app:8090/ -c rules.tsv -r zap.html -J zap.json -I' \
  <"$ROOT/scripts/zap-rules.tsv"
status=$?
set -e
docker cp vfdb-zap:/zap/wrk/zap.html "$OUT/" 2>/dev/null || true
docker cp vfdb-zap:/zap/wrk/zap.json "$OUT/" 2>/dev/null || true
[ -s "$OUT/zap.json" ] || { echo "✗ ZAP produced no report — the scan did not run" >&2; exit 2; }
node "$ROOT/scripts/zap-sarif.mjs" "$OUT/zap.json" >"$OUT/zap.sarif"
# -I only stops ZAP failing on WARN; the verdict on every alert is ours.
verdict=0
node "$ROOT/scripts/zap-verdict.ts" "$OUT/zap.json" "$ROOT/scripts/zap-rules.tsv" || verdict=$?
if [ "$verdict" -eq 2 ]; then exit 2; fi
case "$status" in
  0) ;;
  1) echo "✗ ZAP exited 1: a FAIL-level alert" >&2; exit 1 ;;
  *) echo "✗ ZAP exited $status: the scan did not complete" >&2; exit 2 ;;
esac
exit "$verdict"
