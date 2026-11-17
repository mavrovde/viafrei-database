# viafrei-database

[![CI](https://github.com/mavrovde/viafrei-database/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mavrovde/viafrei-database/actions/workflows/ci.yml)
[![Security](https://github.com/mavrovde/viafrei-database/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/mavrovde/viafrei-database/actions/workflows/security.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/mavrovde/viafrei-database/badge)](https://scorecard.dev/viewer/?uri=github.com/mavrovde/viafrei-database)
![coverage](https://img.shields.io/badge/coverage-lines%20100%25-brightgreen)
[![licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)
![release](https://img.shields.io/github/v/release/mavrovde/viafrei-database?sort=semver)

*The German Real-Time Mobility Context Platform for AI*

**The schema of [ViaFrei](https://viafrei.de), and the one small service that
owns it.** ViaFrei is real-time mobility context for AI assistants in Germany:
motorway traffic and closures, public transport, fuel, charging, parking,
weather warnings and places, from open data. Every real-time tick is kept as
history in PostgreSQL 16 with PostGIS 3.4. This repository holds that
database's migrations, and a container that applies them, keeps the tick
tables' partitions ahead of time and tells everyone else when the schema is
ready.

```
docker run --rm -e DATABASE_URL=postgresql://… ghcr.io/mavrovde/viafrei-database migrate
```

## What the schema holds

Every real-time tick is kept as history, never overwritten: the tick tables
are append-only and partitioned by day, and every time is stored as
`timestamptz` in UTC. Reference data is what those ticks are about, kept
current by the loaders and stamped with when it was first and last seen.

| Domain | Kind |
|---|---|
| Motorway events and traffic | append-only real-time ticks (day-partitioned): events, traffic counts and level of service, over a reference of motorways and junctions |
| Roadworks and closures | current records with their version history, plus append-only road-event ticks (day-partitioned) |
| Public transport (GTFS, real time) | reference: stops, routes, trips and stop times from GTFS; append-only real-time ticks (day-partitioned): delays and estimated calls |
| Fuel prices | append-only real-time ticks (day-partitioned), over a reference of stations and products |
| Charging | append-only real-time ticks (day-partitioned): point status, over a reference of sites and points |
| Parking | append-only real-time ticks (day-partitioned): occupancy, over a reference of facilities |
| Weather warnings | current records with their version history |
| Places, the gazetteer and addresses | reference data |
| The attribution and licence register | reference data: every source with its licence, attribution and limits |
| The API's read contract (`contract`) | views in the shape viafrei-api reads, contract version 0.3 (`contract_info` states it), read by `api_reader` alone. Every view reads the tables above (0312; `departure` is the live board, each scheduled call with the newest DELFI SIRI ET or Trip Updates figure, as the platform's departure tools read it) and appends a licence envelope to each row (`source_ref`, `source_refs`, `display_class`, `audience`, confidentiality, terms gate, hold) from `public.contract_source_rules`, which the API enforces per key. The source register (0309), the curated driving rules and low-emission zones (0310) and the message coverage (0311) are tables of their own, so `source_note`, `rule_topic`, `rule_statement` and `message_coverage` publish rows too; 0313 adds the indexes the API's reads need to stay index scans |
| Train boards (`domains.train_board_departures`) | append-only real-time ticks (day-partitioned, kept 14 days): the DB Timetables departure boards fetched for a person, one row per departure per fetch, appended by the live ingestor alone; `contract.train_board` publishes each station's newest fetch (0314, 0315) |
| The API's access store (`access`) | plans, keys (stored as MACs, never secrets), terms acceptances, hourly usage, an append-only audit and the owner console's passkeys, written by `api_access` alone |
| On-demand refreshes (`live`) | `live.refresh_requests` and `live.refresh_askers` (0315): a refresh viafrei-api records (`api_access` inserts and reads both) and the live ingestor claims and settles (`viafrei_live_ingestor` updates the claim and settle columns only); one open request per source and subject. Public ids only, never a person's position: a check per source pins the subject's form. `live_refresh_requested` is notified on insert, `live_refresh_settled` on settle. Kept 30 days after `created_at`, in any state: `live.prune_refresh_requests(before)` deletes older rows with their askers and refuses a date less than 30 days ago. No provider data passes through this schema |
| The service roles | one login role per service, each granted only what it reads or writes: the platform's own; viafrei-api's `api_reader` (0307, the contract only) and `api_access` (0308, the access store and the refresh requests); and the live ingestor's `viafrei_live_ingestor` (0315: the claim and settle of a refresh request, the train boards, the fuel price path's tables and the request budget functions it calls) |

Prices are `numeric`, never floating point; places are mostly
`geography(Point, 4326)` with a GiST index, and some `geometry`, including
EPSG:25832.

## Why it exists

A schema shared by several services needs one owner. Without one, each
service migrates on its own start, races the others, and finds out at runtime
that a column it reads is not there yet. Here the database has its own
release, its own image and its own readiness signal:

- **One migrator.** A PostgreSQL advisory lock means only one migration run
  happens at a time, even when replicas start together.
- **One ledger.** `schema_migrations` records each applied file's version,
  name and SHA-256. An applied migration that was later edited stops the run
  instead of drifting silently.
- **One readiness answer.** `GET /ready` returns `200 READY <head>` only when
  the database holds every migration this image carries with equal checksums,
  today's and tomorrow's partitions exist and the service roles have their
  passwords. Other workloads wait on it (an init container, a compose
  `depends_on`) and never start against a half-migrated schema.

## Quick start

You need Docker and an empty PostGIS database.

```bash
docker network create vf
docker run -d --name pg --network vf -e POSTGRES_PASSWORD=dev postgis/postgis:16-3.4
docker run --rm --network vf -e DATABASE_URL=postgresql://postgres:dev@pg:5432/postgres \
  ghcr.io/mavrovde/viafrei-database migrate          # apply every migration
docker run --rm --network vf -e DATABASE_URL=postgresql://postgres:dev@pg:5432/postgres \
  ghcr.io/mavrovde/viafrei-database head             # READY <head>
```

To run it as a service instead (migrate, ensure partitions, then serve), see
[docs/deployment.md](docs/deployment.md).

## Commands

| Command | What it does |
|---|---|
| `serve` (default) | Runs migrate, then partitions ensure (30 days ahead), then the role passwords. Then it serves `/healthz` and `/ready` on 8080, and the interface on 8090 when `DB_HOST` is set. A failed step is retried with backoff while the process stays up and not ready |
| `migrate [--dry-run]` | Applies the pending migrations in order, each in its own transaction (except files marked `-- no-transaction:`), and reads the ledger back after each: a file psql reports as run but whose version is not in `schema_migrations` (it quit psql with `\q`, or switched `ON_ERROR_STOP` off before an error) fails the run with exit 1, naming the file. After every successful run (not a dry run) it applies the role settings of `db/roles/settings.sql` to this database, so a database copied from a template (`CREATE DATABASE … TEMPLATE`, which copies no role setting) gets them even when nothing is pending |
| `partitions ensure [--days N] [--days-back B \| --from YYYY-MM-DD]` | Creates the daily partitions of every tick table from 3 days back (or B days back, or from the given date; at most 400) through today + N, so a test or a restore that needs a dated past row gets its partition without writing `partition of` |
| `roles settings` | Applies the role settings (`ALTER ROLE … IN DATABASE`: timeouts, memory, `jit`, read-only) and the one database-wide setting production holds (PostGIS's `search_path`) to this database alone |
| `roles passwords` | Applies the role passwords from `VF_DB_ROLE_DIR` outside `serve`, the same step `serve` runs at boot; without `VF_DB_ROLE_DIR` it is a usage error (exit 2) |
| `check` | A verdict: schema at head, and today and tomorrow covered on every tick table (the tick tables have no default partition on purpose: a tick outside the window is refused, so a default partition is reported as a warning) |
| `head` | Prints `READY <head>` (exit 0) or `NOT READY: <why>` (exit 1) |
| `status` | All the diagnostics below, as JSON |
| `analyze <table>` | `ANALYZE` on one table, found by name in the catalogue |
| `lint [--root DIR]` | The migration lint: naming, contiguous numbering, a carried file equal to its `ledger.tsv` row, a rollback note that names its own ledger row, `concurrently` only where marked, no edit to a file already on `origin/main`, and (rule 6, from 0294) a `set local lock_timeout` before the first statement that takes a strong lock on a table the file did not create — a non-concurrent `create index`, `alter table`, `create`/`drop trigger`, `lock table`, `truncate`, a non-concurrent `drop index` or `reindex`, `create or replace view`, or an `execute format('alter …')` in a `do` block (function bodies are not read; the rule's header in `src/lint/check-migrations.ts` names what it cannot see) — so a migration gives up on a writer's lock instead of queueing behind it; `migrate` retries a lock timeout (SQLSTATE 55P03) `DB_MIGRATE_LOCK_ATTEMPTS` times and stops with 75 after the last |
| `test-fixtures install` | Test databases only: installs the fixture functions of `db/test-fixtures/vf_test.sql` (see [Test fixtures](#test-fixtures)). Refused with exit 2, before any connection, unless `VF_TEST_FIXTURES=1` is set and the database `DATABASE_URL` names starts with `test_`; the file refuses again on the server's own database name. Never run by `migrate` or `serve` |
| `test-fixtures seed FILE` | Test databases only, same gate as `install`: runs FILE's `insert into contract.<relation> (<contract columns>) values ...` statements through `db/test-fixtures/contract_seed.sql`, whose INSTEAD OF INSERT triggers write the platform tables each view reads and raise unless the view reads the row back as given (`source_ref` unchanged). One transaction; a database is seeded once, a second seed is refused. Never run by `migrate` or `serve` |
| `export-migrations` | Writes the baseline and the migrations this image carries to stdout as a tar, so another project's tests can build a throwaway database from the exact same files |
| `version` | Prints `viafrei-database <version> schema-head <N>` |
| `ledger-compare <file\|->` | Read-only, needs no database: compares an exported ledger (`version`, `name`, `checksum`, tab- or `\|`-separated, e.g. `psql -At -c "select version, name, checksum from schema_migrations order by version"`) with the baseline's `ledger.tsv` and names every version that differs. Exit 0 when all are equal |

### Partition index names

`partitions ensure` creates a day as `CREATE TABLE <table>_YYYYMMDD PARTITION OF <table>`,
and PostgreSQL names each index it clones onto that day from the parent index alone
(`test/index-names.ts`, held against every partition by `test/partitioned.db.test.ts`):
`<partition>_pkey` for the primary key, `<partition>_<columns>_key` for a unique
constraint, `<partition>_<columns>_idx` for any other index. `<columns>` is the key's
column names joined by `_` (an expression by its function's name, `left`), and the whole
is cut to 63 bytes by shortening the longer part. On a clash the label takes the first
free number in the schema (`_idx1`).

The names are a function of the day everywhere but four parent indexes of schema
`domains` — `charging_point_status_owner_key`, `parking_occupancy_sid_owner_key`,
`road_weather_forecast_owner_key` and `road_weather_forecast_station` — where the cut
reaches the day, so every day's clone shares one base and is numbered in the order the
days were made (`charging_point_status_2026111_source_id_feed_external_id_o_key3`).
Name a partition's index by its parent (`pg_inherits`), never by the clone's name.

## The baseline

The schema's first versions are one file: `db/baseline/0293_baseline.sql`,
with `db/baseline/ledger.tsv` listing every version it stands for, by number,
name and SHA-256. On an empty database `migrate` applies the baseline and
writes all of its ledger rows in one transaction. A database that already
holds those rows with equal checksums skips it.

The baseline's newest version also ships as a file,
`db/migrations/0293_neutral_texts.sql`, byte for byte the one `ledger.tsv`
records. A database that holds 1..292 gets that file applied and reaches the
same ledger as an empty one. Any other database that holds only some of the
baseline's versions is refused rather than guessed at. New migrations in
`db/migrations` continue from `0294`, and the baseline itself is never edited.

## The diagnostics page

With `DB_HOST` set, port 8090 serves one small server-rendered page with no
JavaScript. It shows:

- readiness and the image and database heads, plus pending and mismatched files;
- PostgreSQL and PostGIS versions, total size and the largest relations
  (a partitioned table counts its partitions);
- the partition window of every tick table, and whether its default partition
  holds rows;
- connections by role and state, queries running over 30 seconds (literals
  hidden), and waiting locks with their blockers;
- autovacuum activity, dead tuples, the oldest transaction ids, and the newest
  rows of the migration ledger.

`/api/status.json` serves the same as JSON. Every diagnostic runs in a
read-only transaction with a statement timeout.

## The safe actions

Signed in, the owner can run **migrate**, **partitions ensure**, **analyze**
and **check** from the page. Nothing drops, truncates or deletes. All four are
idempotent and run one at a time.

## Security model

- **Two allow-list layers.** Put the interface behind a reverse proxy that
  allows only your addresses. The service checks a second allow-list itself
  (`DB_ALLOW_CIDR`). It trusts `X-Forwarded-For` only from `DB_TRUSTED_PROXY_CIDR`,
  read from the right. A refusal is `403` with an empty body: nothing about
  what is behind it.
- **The readiness port is separate** and never routed; only your workloads
  reach it.
- **Actions need a sign-in.** The token is never stored: only its SHA-256 is
  (`DB_OWNER_TOKEN_SHA256`). A sign-in gets a `__Host-` session cookie
  (Secure, HttpOnly, SameSite=Strict). Every POST checks Origin and a CSRF
  token. Every action needs a confirmation that is bound to the action and its
  subject, valid two minutes and usable once. Sign-in failures are rate-limited.
- **Sign-out revokes.** The service remembers the sessions it issued; signing
  out forgets the session, so a copied cookie stops working, and a restart
  signs everyone out.
- **One replica for the interface.** Sessions, single-use confirmations and
  the sign-in rate limit live in the process. Run the interface on one
  replica (see [docs/deployment.md](docs/deployment.md#replicas)).
- **Strict headers.** The CSP is `default-src 'none'`; there is no script and
  no framing. Every response also carries a Permissions-Policy and the
  cross-origin isolation headers (COOP, COEP, CORP). The service itself speaks
  plain HTTP, so it sends no HSTS: set `Strict-Transport-Security` on the
  TLS-terminating proxy in front of the interface.
- **Passwords never reach argv.** The database password goes to `psql` via
  `PGPASSWORD`, never as an argument. Service-role passwords come from mounted
  secret files as the first line of stdin, with statement logging off for that
  session.
- **A small, hardened image.** It runs as a non-root uid, works on a read-only
  root file system with all capabilities dropped, and its base is pinned by
  digest.

Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Images and versions

Images are published to `ghcr.io/mavrovde/viafrei-database` for releases
only, never for a branch or a commit on `main`. The version is the semantic
version of this database service (`package.json`): a minor adds migrations or
a capability, a patch fixes one, and a migration that changes what an existing
reader sees is said in the release notes.

| Tag | Points at |
|---|---|
| `X.Y.Z` | that release; never moved or re-pushed |
| `X.Y` | the newest patch of that minor |
| `latest` | the newest release |

`X.Y` and `latest` follow the highest `vX.Y.Z` **tag**, counted when a
release runs. A tag whose release failed still counts: a later, lower patch
does not move `latest` past it. A version tag is never reused, moved or
deleted: a release that stopped for an outside reason is started again on
the same tag, and a fault in the tagged commit is fixed forward with a new
patch ([CONTRIBUTING](CONTRIBUTING.md#releases) says which applies when).

Versions come from the commit messages on `main`
([Conventional Commits](CONTRIBUTING.md#pull-requests)). release-please keeps
a release pull request open that bumps `package.json` and writes the
`CHANGELOG.md` section; merging it releases:

```text
merge of the release pull request into main
  -> CI and Security succeed on that commit
  -> a draft GitHub release, then the annotated tag vX.Y.Z on that commit
     (CI and Security checked again first; an existing tag is refused)
  -> the release workflow, started on that tag:
     gate, every mutant (npm run mutate), build, push by digest, sign,
     attest, verify, tag the image
  -> the draft release is published with the image digest and how to verify it
```

The next release pull request is built only once the released version has its
tag: the tag job starts release-please again for that, after it has started
the release. Until the tag exists, release-please would count from
bootstrap-sha (the 0.1.0 commit) and list released changes again.

The release workflow always runs on a tag, so whatever started it (the
release pull request, a maintainer pushing an annotated `vX.Y.Z` tag by hand,
or a retry with `gh workflow run release.yml --ref vX.Y.Z`) it passes the same
gate and signs with the same identity.

A release is published only from an annotated `vX.Y.Z` tag (no pre-release
suffix: an `rc` tag publishes nothing) whose version equals `package.json`,
whose commit is on `main` and whose CI and Security workflows concluded
successfully on that commit (the newest run of each, a push to `main`).
Every mutant of `npm run mutate` must then be killed on that commit (the
Mutation check job); a survivor stops the release before anything is built.
Each image is built for `linux/amd64` and `linux/arm64`, carries the OCI
`version`, `revision` and `source` labels, and is signed with cosign (keyless)
with a build-provenance attestation and an SPDX SBOM. Before it is pushed, the
release checks that `docker run IMAGE version` reports the tag's version and
that the image's schema head is the newest version in the tree. It is pushed
by digest only, signed and attested, then pulled, verified and probed
(`/healthz`, `/ready`). Only then are the tags above pointed at that digest,
so a release that fails on the way leaves no tag behind. The release page
is published last and carries the digest and the commands below.

Pin by digest, and verify the signature before you run it:

```bash
cosign verify ghcr.io/mavrovde/viafrei-database@sha256:<digest> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/mavrovde/viafrei-database/\.github/workflows/release\.yml@refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$'
gh attestation verify oci://ghcr.io/mavrovde/viafrei-database@sha256:<digest> --repo mavrovde/viafrei-database \
  --signer-workflow mavrovde/viafrei-database/.github/workflows/release.yml
```

The identity accepts the release workflow on a version tag only, so an image
signed from a branch or by any other workflow does not verify. A tag runs the
workflow file of the commit it points at, so also check that the commit which
signed the image is on `main`:

```bash
sha=$(cosign verify ghcr.io/mavrovde/viafrei-database@sha256:<digest> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/mavrovde/viafrei-database/\.github/workflows/release\.yml@refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$' \
  --output json | jq -r '.[0].optional.githubWorkflowSha')
gh api "repos/mavrovde/viafrei-database/compare/main...$sha" --jq .status   # must print identical or behind
```

Anything else (`ahead`, `diverged`, an error) means the image was not built
from `main`'s history: do not run it.

## Checks

Every pull request and every push to `main` runs these jobs (dependency
review runs on pull requests only); branch protection requires them by name.
When each one runs, scheduled scans included: [SECURITY.md](SECURITY.md).

| Workflow | Job | What it checks |
|---|---|---|
| CI | Lint | `tsc`, ESLint, the shell scripts' syntax, and actionlint (with shellcheck) over every workflow |
| CI | Unit tests | the unit suite, no database, each case under two seconds |
| CI | Migration lint | `viafrei-db lint` over the baseline and the migrations |
| CI | Integration tests (PostGIS) | an empty database (a plain `create database` in a PostGIS cluster) migrated to head through the service, under the coverage gate: lines 100 · branches 93.88 · functions 100 · statements 100 (per cent, minimums; below any one fails the job, and so does a coverage badge that differs from the measured lines figure); then the schema coverage gate (below) |
| CI | Image (build, scan, healthz) | the image is built, scanned by Trivy (HIGH and CRITICAL fail) and started read-only as a non-root user to answer `/healthz` and `/ready` |
| Security | CodeQL (TypeScript) | static analysis, the extended query set |
| Security | Dependency review | a pull request adds no dependency with a known advisory |
| Security | Secrets in history (gitleaks) | no secret anywhere in the history |
| Security | DAST (OWASP ZAP against the container) | the running interface, attacked from outside; any alert, at any risk level, fails unless `scripts/zap-rules.tsv` marks its rule IGNORE with a reason |
| Scorecard | Scorecard analysis | the OpenSSF Scorecard of this repository; the exception to the sentence above, it runs weekly and on a branch-protection change only |
| Snyk | Snyk (dependencies) | Snyk Open Source over the npm dependencies (high or critical fails); another exception, it runs weekly on `main` only, never on a pull request or a push |
| Release | Release gate | a tag publishes an image only when it is an annotated `vX.Y.Z` on `main`, equals `package.json`, names the commit the run was started for, and its CI and Security workflows concluded successfully on that commit |
| Release | Mutation check | every mutant of `npm run mutate` on that commit, against an empty PostGIS, before anything is built: one surviving mutant, a mutant whose pattern no longer matches, or a unit or database run that fails before any mutant is planted stops the release. This is the only run of the full set; no pull request or push runs it |
| Release | Snyk (dependencies) | the same Snyk scan, called on that commit before anything is built: a high or critical advisory stops the release |

What changed when: [CHANGELOG.md](CHANGELOG.md).

## Schema coverage

Every object in the catalogue of a database migrated to head is proved by a
test here (#32): `npm run coverage:schema` reads the tables, views, functions,
triggers, checks, policies, grants (to a `viafrei_*` role or PUBLIC), the
`viafrei_*` roles and the partitioned tables, extension members and partitions
left out, and judges them against two files:

- `test/coverage/schema.tsv` — `kind`, `object`, `<test file> > <test title>`,
  one row per object and test that proves it;
- `test/coverage/gap.tsv` — `kind`, `object`: what has no test yet. It only
  shrinks, and is empty at the release that closes #32.

It fails on an object with neither row, a row naming an object or a test that
does not exist, and a gap row the manifest covers or the catalogue no longer
holds. It refuses (exit 2) a catalogue read with no object of a kind the schema
always holds, a database that was never migrated or is not at the checkout's
head, an empty manifest, and a test tree it cannot list. Without `--url` it
migrates a throwaway database next to `TEST_DATABASE_URL` and drops it.

The `fixture` kind is the test-only functions of `db/test-fixtures/vf_test.sql`,
read from the file because no served catalogue holds them: the gate refuses a
catalogue that does (the fixtures were installed on it), and a file that
defines none.

## Test fixtures

A test that must plant a row a guard refuses (a frozen slug, a value outside a
licence floor, a postcode as a feed wrote it, a row from before a CHECK
existed) lifts that one guard through a fixture function, inside its own
transaction, and rolls back. `viafrei-db test-fixtures install` (with
`VF_TEST_FIXTURES=1`, on a `test_` database) puts them in the schemas
`vf_test`, `vf_test_clock` and `vf_test_shadow`; no other verb does.

```sql
begin;
set local vf_test.armed = 'on';
select vf_test.unfreeze_station_slugs();
-- the plant and the test
rollback;
```

Every function first calls `vf_test.armed()`, which refuses outside a `test_`
database (42501), without `vf_test.armed = 'on'` (55000) and in autocommit
(25P01), so a lift cannot outlive the test that asked for it.

| Function | Lifts |
|---|---|
| `vf_test.unfreeze_station_slugs()` | the trigger `station_slugs_frozen` |
| `vf_test.lift_runtime_config_source_bounds()` | the trigger `runtime_config_source_bounds` |
| `vf_test.lift_postcode_trigger(relation)` | that table's `vf_postcode_normalise` trigger |
| `vf_test.drop_check(relation, name)` | one CHECK constraint (a key or a foreign key is refused) |
| `vf_test.set_n_distinct(relation, column, n)` | one column's `n_distinct` (applied by the next `ANALYZE`) |
| `vf_test.set_clock(at)` | `now()` in an unqualified query reads `at` (`vf_test_clock.now()` first on the search path) |
| `vf_test.shadow_rows(relation, rows)` / `shadow_slow(relation, seconds)` / `shadow_put(relation, body)` | an unqualified read of the relation sees the given rows, waits first, or reads the given query (a view in `vf_test_shadow`, granted to the original's readers) |
| `vf_test.revoke_select(relation, role)` | one role's SELECT on one relation |

## Development

```bash
npm ci
npm run typecheck && npm run lint && npm test        # each unit test < 2 s
TEST_DATABASE_URL=postgresql://… npm run test:db     # empty PostGIS → head
TEST_DATABASE_URL=postgresql://… npm run coverage    # both, with the coverage gate
scripts/image-smoke.sh                               # build + harden + serve + probe
TEST_DATABASE_URL=postgresql://… npm run mutate -- --only <text>   # the mutants whose name contains <text>; the full set is run by the release (below)
TEST_DATABASE_URL=postgresql://… npm run coverage:schema   # every catalogue object has its test (or a gap row)
npm run coverage:schema -- --gap                     # the uncovered objects, as gap.tsv rows
```

The mutation tally is proved by the release workflow: its Mutation check job
runs every mutant on the tagged commit before the image is built, and the
release stops on a survivor. There is no separate local run of the full set to
record; `--only` is for working on one mutant.

[CONTRIBUTING.md](CONTRIBUTING.md) has the migration rules.

## The ViaFrei projects

| Repository | Area |
|---|---|
| [viafrei-mcp](https://github.com/mavrovde/viafrei-mcp) | the stdio bridge to the hosted MCP server |
| [viafrei-api](https://github.com/mavrovde/viafrei-api) | the REST API's contract and server |
| **viafrei-database** | the schema, its migrations and the service that owns them |

ViaFrei itself runs at [viafrei.de](https://viafrei.de); its hosted MCP server is `mcp.viafrei.de`.

## Licence

[Apache-2.0](LICENSE). This covers the code and schema only. Data you load
keeps its provider's licence; see [NOTICE](NOTICE).
