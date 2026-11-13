#!/usr/bin/env bash
# The baseline, made and proved, from a directory of ORIGINAL migrations
# (0001..N, the files the ledger's checksums were taken of):
#
#   scripts/baseline.sh generate    <originals-dir>   writes db/baseline/
#   scripts/baseline.sh equivalence <originals-dir>   proves db/baseline/ equals them
#
# Every database here is made with a plain `create database` (from template1),
# never the image's POSTGRES_DB: the postgis image's init puts fuzzystrmatch,
# postgis_tiger_geocoder, postgis_topology and their schemas into that one,
# and no migration makes them, so they must not reach the baseline.
#
# generate: an empty PostGIS is migrated file by file from <originals-dir>
# by this repository's own image (the path production took), then dumped:
# the viafrei_* roles (pg_dumpall --roles-only --no-role-passwords) and the
# schema with its seed data (pg_dump --no-owner, without schema_migrations
# and without the dated daily partitions, which `partitions ensure` makes).
# Both go through scripts/baseline-scrub.ts. The ledger table's own privileges
# (a migration grants on schema_migrations, which the dump leaves out) are
# appended as GRANT statements: migrate creates the table before the baseline
# runs. ledger.tsv is the ledger the migration wrote, checked row by row
# against the sha256 of each original.
#
# equivalence: three empty clusters. A is migrated from <originals-dir>; B
# from db/baseline and the files this repository tracks in db/migrations (the
# CARRIED files: on an empty database the baseline stands for them); C takes
# the production path — migrated from the originals BEFORE the carried files,
# then from db/baseline and the tracked files, so it must apply exactly the
# carried files and nothing else. A and C are each compared with B. Equal means: the same roles, memberships and settings,
# the same extensions and schemas, the same privileges (every relation, column,
# function, schema and default privilege of ours, schema_migrations included),
# the same columns of every relation (from the catalogue), the same schema
# dump (byte for byte, or once pg_dump's deparse round trip is normalised on
# both sides: flat AND chains, type-named constant aliases — counted), the
# same data dump (scrubbed alike, timestamps masked), every function body's CODE the same (read UNSCRUBBED from
# pg_proc: equal, or differing only by lines proven to be whole-line
# comments), and the same ledger rows, equal to ledger.tsv. Then B passes
# `partitions ensure` and `check`, and the baseline is applied once more to a
# database made from template_postgis (the production shape: the image's
# extras already there), which must reach head, pass `check`, and hold the same
# columns and privileges outside the extras' schemas. Run it whenever
# db/baseline, the migrate code or the PostgreSQL version changes.
#
# Heavy: three PostGIS containers and an image build. Every container, the
# network and the work directory are removed on every exit path.
# Exit 0 = done / equal; 1 = different (a diff on stderr); 2 = cannot run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POSTGIS="${BASELINE_POSTGIS_IMAGE:-postgis/postgis:16-3.4@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5}"
OWNER=vfowner
PASS=baseline
DB=viafrei
TAG="baseline-$$"
NET="vfdb-$TAG"
IMAGE="${IMAGE:-}"
DATED='public.*_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
WORK=""
BUILT=""

die() { printf '✗ %s\n' "$1" >&2; exit "${2:-2}"; }
cleanup() {
  docker rm -f "vfdb-a-$TAG" "vfdb-b-$TAG" "vfdb-c-$TAG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  # The image this run built (never one handed in through IMAGE).
  [ -n "$BUILT" ] && docker image rm "$BUILT" >/dev/null 2>&1
  [ -n "$WORK" ] && rm -rf "$WORK"
  return 0
}
trap cleanup EXIT

MODE="${1:-}"
ORIG="${2:-}"
[ "$MODE" = generate ] || [ "$MODE" = equivalence ] || die "usage: scripts/baseline.sh generate|equivalence <originals-dir>"
[ -n "$ORIG" ] && [ -d "$ORIG" ] || die "no originals directory given"
ORIG="$(cd "$ORIG" && pwd)"
command -v docker >/dev/null || die "docker is not on PATH"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 23 ? 0 : 1)' || die "node 23 or newer is needed (it runs scripts/*.ts as they are)"

# The originals: contiguous from 0001, at least one.
n=0
for f in "$ORIG"/[0-9][0-9][0-9][0-9]_*.sql; do
  [ -e "$f" ] || break
  n=$((n + 1))
  b="$(basename "$f")"
  [ "$((10#${b:0:4}))" -eq "$n" ] || die "$b: expected number $(printf '%04d' "$n") — the originals must be contiguous from 0001"
done
[ "$n" -ge 1 ] || die "$ORIG holds no NNNN_*.sql file"
HEAD="$n"
BASELINE_SQL="$(printf '%04d' "$HEAD")_baseline.sql"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vfdb-baseline.XXXXXX")"
chmod 755 "$WORK" # the image runs as uid 10001
if [ -z "$IMAGE" ]; then
  IMAGE="viafrei-database:$TAG"
  BUILT="$IMAGE"
  docker build -q -t "$IMAGE" "$ROOT" >/dev/null
fi
docker network create "$NET" >/dev/null

# An empty cluster, the owner a plain superuser named $OWNER, and $DB made
# with a plain `create database`: nothing in it but what template1 holds.
cluster() {
  docker run -d --name "vfdb-$1-$TAG" --network "$NET" --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_USER="$OWNER" -e POSTGRES_PASSWORD="$PASS" -e POSTGRES_DB=postgres "$POSTGIS" >/dev/null
  for _ in $(seq 1 120); do
    if docker exec "vfdb-$1-$TAG" pg_isready -h 127.0.0.1 -U "$OWNER" -d postgres -q 2>/dev/null; then
      docker exec "vfdb-$1-$TAG" psql -X -q -v ON_ERROR_STOP=1 -U "$OWNER" -h 127.0.0.1 -d postgres -c "create database $DB" >/dev/null
      return 0
    fi
    sleep 1
  done
  die "cluster $1 did not start"
}
q() { docker exec -i "vfdb-$1-$TAG" psql -X -v ON_ERROR_STOP=1 -U "$OWNER" -h 127.0.0.1 -d "${QDB:-$DB}" -At "${@:2}"; }
# The image, against cluster $1, with the schema dirs $2 (migrations) and $3
# (baseline); "-" for a directory that must not exist (an empty one is not "none").
app() {
  local c="$1" mig="$2" base="$3" mounts=()
  shift 3
  if [ "$mig" = - ]; then mig=/schema/absent; else mounts+=(-v "$mig:/schema/migrations:ro"); mig=/schema/migrations; fi
  if [ "$base" = - ]; then base=/schema/absent; else mounts+=(-v "$base:/schema/baseline:ro"); base=/schema/baseline; fi
  docker run --rm --network "$NET" --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges "${mounts[@]}" \
    -e DATABASE_URL="postgresql://$OWNER:$PASS@vfdb-$c-$TAG:5432/${APPDB:-$DB}" \
    -e VF_DB_MIGRATIONS_DIR="$mig" -e VF_DB_BASELINE_DIR="$base" \
    "$IMAGE" "$@"
}
ledger() { q "$1" -F $'\t' -c 'select version, name, checksum from schema_migrations order by version'; }
schema_dump() { docker exec "vfdb-$1-$TAG" pg_dump -U "$OWNER" -h 127.0.0.1 -d "$DB" --schema-only --exclude-table=public.schema_migrations --exclude-table="$DATED"; }
data_dump() { docker exec "vfdb-$1-$TAG" pg_dump -U "$OWNER" -h 127.0.0.1 -d "$DB" --data-only --exclude-table=public.schema_migrations --exclude-table="$DATED"; }
roles() {
  q "$1" -F $'\t' -c "select r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls, r.rolconnlimit from pg_roles r where r.rolname like 'viafrei\\_%' order by 1"
  q "$1" -F $'\t' -c "select g.rolname, case when m.rolname = current_user then 'CURRENT_USER' else m.rolname end, am.admin_option, am.inherit_option, am.set_option from pg_auth_members am join pg_roles g on g.oid = am.roleid join pg_roles m on m.oid = am.member where g.rolname like 'viafrei\\_%' or m.rolname like 'viafrei\\_%' order by 1, 2"
  # The settings in force in this database, cluster-wide or scoped to it: the
  # originals set them cluster-wide, the baseline scopes them to its database.
  q "$1" -F $'\t' -c "select case when r.rolname = current_user then 'CURRENT_USER' else r.rolname end, c from pg_db_role_setting s join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c where s.setdatabase in (0, (select oid from pg_database where datname = current_database())) and (r.rolname like 'viafrei\\_%' or r.rolname = current_user) order by 1, 2"
}
# Every function body of ours, UNSCRUBBED: signature, language, base64 of prosrc (extension members excluded).
bodies() {
  q "$1" -F $'\t' -c "select p.oid::regprocedure::text, l.lanname, translate(encode(convert_to(p.prosrc, 'UTF8'), 'base64'), E'\\n', '') from pg_proc p join pg_language l on l.oid = p.prolang join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%' and not exists (select from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') order by 1"
}
# Every column of every relation of ours (views included), from the catalogue:
# the names a deparse normalisation could otherwise hide.
columns() {
  q "$1" -F $'\t' -c "select n.nspname, c.relname, c.relkind, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%' and c.relname !~ '_[0-9]{8}$' and c.relname <> 'schema_migrations' order by 1, 2, a.attnum"
}
# The extensions and the schemas of the database.
extensions() { q "$1" -F $'\t' -c "select e.extname, e.extversion, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1"; }
namespaces() { q "$1" -F $'\t' -c "select n.nspname, pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema' order by 1"; }
# Every privilege of ours, from the catalogue: relations (schema_migrations
# included), columns, functions, schemas and default privileges. Extension
# members and the dated partitions are left out; NOT_IN names schemas to skip.
# An ACL equal to acldefault() is printed as '-', like a null one: both grant
# exactly the owner's defaults, and a GRANT then REVOKE in a migration leaves
# the explicit form where the dump's replay leaves null.
acls() {
  local ours="n.nspname not in ('pg_catalog', 'information_schema'${NOT_IN:-}) and n.nspname not like 'pg\\_%'"
  local ext="not exists (select from pg_depend d where d.objid = %s and d.classid = '%s'::regclass and d.deptype = 'e')"
  # shellcheck disable=SC2059
  q "$1" -F $'\t' -c "
select 'relation', n.nspname, c.relname, c.relkind::text, case when c.relacl is null or c.relacl = acldefault((case when c.relkind = 'S' then 's' else 'r' end)::\"char\", c.relowner) then '-' else c.relacl::text end from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and $ours and c.relname !~ '_[0-9]{8}\$' and $(printf "$ext" c.oid pg_class)
union all
select 'column', n.nspname, c.relname || '.' || a.attname, '', a.attacl::text from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
 where a.attacl is not null and a.attnum > 0 and $ours and c.relname !~ '_[0-9]{8}\$'
union all
select 'function', n.nspname, p.oid::regprocedure::text, p.prokind::text, case when p.proacl is null or p.proacl = acldefault('f'::\"char\", p.proowner) then '-' else p.proacl::text end from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where $ours and $(printf "$ext" p.oid pg_proc)
union all
select 'schema', n.nspname, '', '', case when n.nspacl is null or n.nspacl = acldefault('n'::\"char\", n.nspowner) then '-' else n.nspacl::text end from pg_namespace n where $ours
union all
select 'default', coalesce(n.nspname, '*'), pg_get_userbyid(d.defaclrole), d.defaclobjtype::text, d.defaclacl::text from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
order by 1, 2, 3, 4"
}
scrub() { node "$ROOT/scripts/baseline-scrub.ts" "$1" "$OWNER"; }
# Instants differ between two runs; their shape does not.
mask() { sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}(:?[0-9]{2})?)?/<ts>/g'; }

if [ "$MODE" = generate ]; then
  cluster a
  app a "$ORIG" - migrate >/dev/null
  ledger a >"$WORK/ledger.rows"
  # The ledger the originals wrote: 1..HEAD, each name and checksum that of its file.
  i=0
  while IFS=$'\t' read -r v name sum; do
    i=$((i + 1))
    [ "$v" -eq "$i" ] || die "ledger row $i holds version $v"
    [ -f "$ORIG/$name" ] || die "ledger row $v names $name, which is not among the originals"
    [ "$(shasum -a 256 "$ORIG/$name" | cut -c1-64)" = "$sum" ] || die "ledger row $v: $name's checksum is not that of its file"
  done <"$WORK/ledger.rows"
  [ "$i" -eq "$HEAD" ] || die "the ledger holds $i rows, the originals $HEAD"

  docker exec "vfdb-a-$TAG" pg_dumpall -U "$OWNER" -h 127.0.0.1 --roles-only --no-role-passwords | scrub roles >"$WORK/roles.sql"
  docker exec "vfdb-a-$TAG" pg_dump -U "$OWNER" -h 127.0.0.1 -d "$DB" --no-owner \
    --exclude-table=public.schema_migrations --exclude-table="$DATED" | scrub dump >"$WORK/body.sql"
  # schema_migrations is not in the dump (migrate creates it), but a migration
  # granted on it: its privileges, and nothing else of it, follow the body.
  docker exec "vfdb-a-$TAG" pg_dump -U "$OWNER" -h 127.0.0.1 -d "$DB" --no-owner --schema-only --table=public.schema_migrations \
    | scrub dump | { grep -E '^(GRANT|REVOKE) ' || true; } >"$WORK/ledger-acl.sql"
  [ -s "$WORK/ledger-acl.sql" ] || die "schema_migrations carries no privilege beyond its owner's: expected the grant of migration 0019"
  mkdir -p "$ROOT/db/baseline"
  {
    printf -- '-- The ViaFrei schema at version %s: what migrations 0001..%04d build on an\n' "$HEAD" "$HEAD"
    printf -- '-- empty database (a plain `create database`), as one file, privileges included.\n'
    printf -- '-- Applied by `migrate` on an EMPTY database only (one the PostGIS image made,\n'
    printf -- '-- holding its init'"'"'s extras, is empty too), in one transaction with the\n'
    printf -- '-- ledger rows of db/baseline/ledger.tsv. Generated\n'
    printf -- '-- by scripts/baseline.sh; never edited (`viafrei-db lint` refuses an edit): write\n-- a migration after it.\n\n'
    cat "$WORK/roles.sql"
    printf '\n'
    cat "$WORK/body.sql"
    printf '\n-- The ledger table'"'"'s privileges: schema_migrations is created by migrate before\n-- this file runs, and is not part of the dump above.\n\n'
    cat "$WORK/ledger-acl.sql"
  } >"$WORK/$BASELINE_SQL"
  { printf 'version\tname\tchecksum\n'; cat "$WORK/ledger.rows"; } >"$WORK/ledger.tsv"
  rm -f "$ROOT"/db/baseline/[0-9][0-9][0-9][0-9]_baseline.sql
  cp "$WORK/$BASELINE_SQL" "$WORK/ledger.tsv" "$ROOT/db/baseline/"
  printf '✓ db/baseline/%s (%s bytes) and ledger.tsv (%s rows) written; now run: scripts/baseline.sh equivalence %s\n' \
    "$BASELINE_SQL" "$(wc -c <"$ROOT/db/baseline/$BASELINE_SQL" | tr -d ' ')" "$HEAD" "$ORIG"
  exit 0
fi

# equivalence
[ -f "$ROOT/db/baseline/ledger.tsv" ] && [ -f "$ROOT/db/baseline/$BASELINE_SQL" ] || die "db/baseline has no $BASELINE_SQL for $HEAD originals — generate it first"
# The files this repository tracks in db/migrations: what an image carries
# beside the baseline. Each must be the original of the same name, byte for byte.
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$ROOT is not a git checkout: the tracked migrations cannot be told from the originals"
mkdir "$WORK/pub" "$WORK/prev"
tracked=0
while IFS= read -r f; do
  b="$(basename "$f")"
  cmp -s "$ROOT/$f" "$ORIG/$b" || die "$f is not byte-identical to $ORIG/$b"
  cp "$ROOT/$f" "$WORK/pub/$b"
  tracked=$((tracked + 1))
done < <(git -C "$ROOT" ls-files 'db/migrations/[0-9][0-9][0-9][0-9]_*.sql')
FIRST_CARRIED=$((HEAD + 1))
for f in "$WORK"/pub/*.sql; do
  [ -e "$f" ] || break
  v=$((10#$(basename "$f" | cut -c1-4)))
  [ "$v" -le "$HEAD" ] && [ "$v" -lt "$FIRST_CARRIED" ] && FIRST_CARRIED="$v"
done
[ "$FIRST_CARRIED" -le "$HEAD" ] || die "no tracked migration carries a version of the baseline: the production path has nothing to apply"
for f in "$ORIG"/[0-9][0-9][0-9][0-9]_*.sql; do
  [ "$((10#$(basename "$f" | cut -c1-4)))" -lt "$FIRST_CARRIED" ] && cp "$f" "$WORK/prev/"
done
printf '  %s tracked file(s); the baseline carries %04d..%04d; production path from %04d\n' "$tracked" "$FIRST_CARRIED" "$HEAD" "$((FIRST_CARRIED - 1))"
cluster a
cluster b
cluster c
app a "$ORIG" - migrate >/dev/null
app b "$WORK/pub" "$ROOT/db/baseline" migrate >"$WORK/b.migrate"
grep -qx "applying the baseline $BASELINE_SQL (versions 1..$HEAD, one transaction)" "$WORK/b.migrate" || die "B did not start from the baseline: $(tail -n 3 "$WORK/b.migrate")" 1
app c "$WORK/prev" - migrate >/dev/null
app c "$WORK/pub" "$ROOT/db/baseline" migrate >"$WORK/c.migrate"
grep '^applying' "$WORK/c.migrate" | sed 's/^applying //' >"$WORK/c.applied" || true
(cd "$WORK/pub" && for f in [0-9][0-9][0-9][0-9]_*.sql; do [ "$((10#${f:0:4}))" -ge "$FIRST_CARRIED" ] && echo "$f"; done) >"$WORK/c.expected"
fails=0
if diff -u "$WORK/c.expected" "$WORK/c.applied" >/dev/null; then
  printf '  ✓ the production path (a database at %04d) applies exactly: %s\n' "$((FIRST_CARRIED - 1))" "$(tr '\n' ' ' <"$WORK/c.applied")"
else
  echo "  ✗ the production path applied something else:" >&2
  diff -u "$WORK/c.expected" "$WORK/c.applied" >&2 || true
  fails=$((fails + 1))
fi
same() {
  if diff -u "$WORK/$2.$1" "$WORK/b.$1" >"$WORK/diff.$2.$1"; then
    printf '  ✓ %s: %s equal (%s lines)\n' "$2" "$1" "$(wc -l <"$WORK/$2.$1" | tr -d ' ')"
  else
    printf '  ✗ %s: %s differ:\n' "$2" "$1" >&2
    head -n 60 "$WORK/diff.$2.$1" >&2
    fails=$((fails + 1))
  fi
}
for c in a b c; do
  roles "$c" >"$WORK/$c.roles"
  schema_dump "$c" | scrub dump >"$WORK/$c.schema"
  data_dump "$c" | scrub dump | mask >"$WORK/$c.data"
  ledger "$c" >"$WORK/$c.ledger"
  bodies "$c" >"$WORK/$c.bodies"
  columns "$c" >"$WORK/$c.columns"
  extensions "$c" >"$WORK/$c.extensions"
  namespaces "$c" >"$WORK/$c.namespaces"
  acls "$c" >"$WORK/$c.acls"
done
for x in a c; do
  echo "  — $x against b ($([ "$x" = a ] && echo 'originals' || echo 'production path'))"
  same roles "$x"
  same extensions "$x"
  same namespaces "$x"
  same acls "$x"
  same columns "$x"
  # Byte for byte, or equal once pg_dump's own deparse round trip is normalised
  # on BOTH sides (scripts/baseline-scrub.ts canonDeparse; counted, never silent).
  if node "$ROOT/scripts/baseline-scrub.ts" schema "$WORK/$x.schema" "$WORK/b.schema"; then :; else fails=$((fails + 1)); fi
  same data "$x"
  same ledger "$x"
  # The function bodies' CODE, from the catalogue and unscrubbed: equal byte for
  # byte, or differing only by lines proven to be whole-line comments.
  if node "$ROOT/scripts/baseline-scrub.ts" bodies "$WORK/$x.bodies" "$WORK/b.bodies"; then :; else fails=$((fails + 1)); fi
done
tail -n +2 "$ROOT/db/baseline/ledger.tsv" >"$WORK/b.tsv"
if diff -q "$WORK/a.ledger" "$WORK/b.tsv" >/dev/null; then echo "  ✓ ledger.tsv equals the originals' ledger"; else echo "  ✗ ledger.tsv differs from the originals' ledger" >&2; fails=$((fails + 1)); fi
app b - "$ROOT/db/baseline" partitions ensure --days 1 >/dev/null
if app b - "$ROOT/db/baseline" check >"$WORK/b.check" 2>&1; then echo "  ✓ the baseline's database passes check"; else
  echo "  ✗ the baseline's database fails check:" >&2
  cat "$WORK/b.check" >&2
  fails=$((fails + 1))
fi
# The production shape: a database made from template_postgis already holds
# the image's extras (fuzzystrmatch, postgis_tiger_geocoder, postgis_topology
# and their schemas). The baseline must apply there, pass check, and leave our
# columns and privileges exactly as on B.
q a -c "create database pre_prod template template_postgis" >/dev/null
if APPDB=pre_prod app a - "$ROOT/db/baseline" migrate >"$WORK/pre.prod" 2>&1 \
  && APPDB=pre_prod app a - "$ROOT/db/baseline" partitions ensure --days 1 >/dev/null 2>&1 \
  && APPDB=pre_prod app a - "$ROOT/db/baseline" check >>"$WORK/pre.prod" 2>&1; then
  QDB=pre_prod columns a | grep -Ev $'^(tiger|tiger_data|topology)\t' >"$WORK/p.columns" || true
  QDB=pre_prod NOT_IN=", 'tiger', 'tiger_data', 'topology'" acls a >"$WORK/p.acls"
  NOT_IN=", 'tiger', 'tiger_data', 'topology'" acls b >"$WORK/b.acls"
  QDB=pre_prod extensions a | cut -f1 | tr '\n' ' ' >"$WORK/p.extnames"
  printf '  ✓ the production shape (extras already there: %s) reaches head and passes check\n' "$(cat "$WORK/p.extnames")"
  same columns p
  same acls p
else
  echo "  ✗ the baseline does not apply to the production shape (a database from template_postgis):" >&2
  tail -n 8 "$WORK/pre.prod" >&2
  fails=$((fails + 1))
fi
# Pre-existing roles (cluster A holds them, made by the originals): the
# baseline must accept roles with its attributes, and refuse, not alter, one
# that differs.
q a -c "create database pre_same" >/dev/null
docker exec "vfdb-a-$TAG" psql -X -q -U "$OWNER" -h 127.0.0.1 -d pre_same -c "create extension if not exists postgis" >/dev/null
if APPDB=pre_same app a - "$ROOT/db/baseline" migrate >"$WORK/pre.same" 2>&1; then echo "  ✓ the baseline accepts existing roles with its attributes"; else
  echo "  ✗ the baseline refuses existing roles with its own attributes:" >&2
  tail -n 5 "$WORK/pre.same" >&2
  fails=$((fails + 1))
fi
victim="$(q a -c "select rolname from pg_roles where rolname like 'viafrei\\_%' order by 1 limit 1")"
before="$(q a -c "select rolcanlogin from pg_roles where rolname = '$victim'")"
q a -c "alter role $victim nologin" >/dev/null
q a -c "create database pre_diff" >/dev/null
docker exec "vfdb-a-$TAG" psql -X -q -U "$OWNER" -h 127.0.0.1 -d pre_diff -c "create extension if not exists postgis" >/dev/null
if APPDB=pre_diff app a - "$ROOT/db/baseline" migrate >"$WORK/pre.diff" 2>&1; then
  echo "  ✗ the baseline accepted $victim with other attributes" >&2
  fails=$((fails + 1))
elif grep -q "role $victim exists with other attributes" "$WORK/pre.diff" && [ "$(q a -c "select rolcanlogin from pg_roles where rolname = '$victim'")" = f ]; then
  echo "  ✓ the baseline refuses $victim with other attributes and leaves it as it was (rolcanlogin was $before)"
else
  echo "  ✗ the baseline failed on $victim for another reason, or altered it:" >&2
  tail -n 5 "$WORK/pre.diff" >&2
  fails=$((fails + 1))
fi
[ "$fails" -eq 0 ] || die "the baseline is NOT equivalent to the $HEAD originals ($fails difference(s))" 1
echo "✓ db/baseline is equivalent to the $HEAD originals"
