# viafrei-database

[![CI](https://github.com/mavrovde/viafrei-database/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mavrovde/viafrei-database/actions/workflows/ci.yml)
[![Security](https://github.com/mavrovde/viafrei-database/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/mavrovde/viafrei-database/actions/workflows/security.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/mavrovde/viafrei-database/badge)](https://scorecard.dev/viewer/?uri=github.com/mavrovde/viafrei-database)
![coverage](https://img.shields.io/badge/coverage-lines%20100%25-brightgreen)
[![licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)
![release](https://img.shields.io/badge/release-none%20yet-lightgrey)

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
| The service roles | one login role per service, each granted only what it reads or writes |

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
| `migrate [--dry-run]` | Applies the pending migrations in order, each in its own transaction (except files marked `-- no-transaction:`) |
| `partitions ensure [--days N]` | Creates the daily partitions of every tick table from 3 days back through today + N |
| `check` | A verdict: schema at head, and today and tomorrow covered on every tick table (the tick tables have no default partition on purpose: a tick outside the window is refused, so a default partition is reported as a warning) |
| `head` | Prints `READY <head>` (exit 0) or `NOT READY: <why>` (exit 1) |
| `status` | All the diagnostics below, as JSON |
| `analyze <table>` | `ANALYZE` on one table, found by name in the catalogue |
| `lint [--root DIR]` | The migration lint: naming, contiguous numbering, a carried file equal to its `ledger.tsv` row, a rollback note that names its own ledger row, `concurrently` only where marked, and no edit to a file already on `origin/main` |
| `export-migrations` | Writes the baseline and the migrations this image carries to stdout as a tar, so another project's tests can build a throwaway database from the exact same files |
| `version` | Prints `viafrei-database <version> schema-head <N>` |
| `ledger-compare <file\|->` | Read-only, needs no database: compares an exported ledger (`version`, `name`, `checksum`, tab- or `\|`-separated, e.g. `psql -At -c "select version, name, checksum from schema_migrations order by version"`) with the baseline's `ledger.tsv` and names every version that differs. Exit 0 when all are equal |

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
does not move `latest` past it. A failed release is fixed forward with a new
patch tag; a version tag is never reused, moved or deleted.

A release is published only from an annotated `vX.Y.Z` tag (no pre-release
suffix: an `rc` tag publishes nothing) whose version equals `package.json`,
whose commit is on `main` and whose CI and Security workflows concluded
successfully on that commit (the newest run of each, a push to `main`).
Each image is built for `linux/amd64` and `linux/arm64`, carries the OCI
`version`, `revision` and `source` labels, and is signed with cosign (keyless)
with a build-provenance attestation and an SPDX SBOM. Before it is pushed, the
release checks that `docker run IMAGE version` reports the tag's version and
that the image's schema head is the newest version in the tree. It is pushed
by digest only, signed and attested, then pulled, verified and probed
(`/healthz`, `/ready`). Only then are the tags above pointed at that digest,
so a release that fails on the way leaves no tag behind.

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
| CI | Integration tests (PostGIS) | an empty database (a plain `create database` in a PostGIS cluster) migrated to head through the service, under the coverage gate: lines 100 · branches 93.88 · functions 100 · statements 100 (per cent, minimums; below any one fails the job, and so does a coverage badge that differs from the measured lines figure) |
| CI | Image (build, scan, healthz) | the image is built, scanned by Trivy (HIGH and CRITICAL fail) and started read-only as a non-root user to answer `/healthz` and `/ready` |
| Security | CodeQL (TypeScript) | static analysis, the extended query set |
| Security | Dependency review | a pull request adds no dependency with a known advisory |
| Security | Secrets in history (gitleaks) | no secret anywhere in the history |
| Security | DAST (OWASP ZAP against the container) | the running interface, attacked from outside; any alert, at any risk level, fails unless `scripts/zap-rules.tsv` marks its rule IGNORE with a reason |
| Scorecard | Scorecard analysis | the OpenSSF Scorecard of this repository |
| Release | Release gate | a tag publishes an image only when it is an annotated `vX.Y.Z` on `main`, equals `package.json`, and its CI and Security workflows concluded successfully on that commit |

What changed when: [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm ci
npm run typecheck && npm run lint && npm test        # each unit test < 2 s
TEST_DATABASE_URL=postgresql://… npm run test:db     # empty PostGIS → head
TEST_DATABASE_URL=postgresql://… npm run coverage    # both, with the coverage gate
scripts/image-smoke.sh                               # build + harden + serve + probe
npm run mutate                                       # the readiness logic's mutants
```

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
