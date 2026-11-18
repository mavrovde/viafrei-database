# Changelog

All notable changes to this project are written here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) for the database
service (`package.json`).

From the release after 0.1.0 on, each section is written by release-please
from the Conventional Commits on `main`, in the release pull request, in its
own format (a version heading linking the comparison, entries linking their
commits) under the Keep a Changelog section names; a released section is not
edited by hand.

## [0.3.2](https://github.com/mavrovde/viafrei-database/compare/v0.3.1...v0.3.2) (2026-11-18)

0.3.1 was tagged but never published: its mutation check ran out of its 120 minutes on both attempts on slow runners (765 and then 790 of its 812 mutants killed, none surviving, when it stopped), so no 0.3.1 image exists. 0.3.2 is the first published release of everything listed under 0.3.1 and 0.3.0 below, and its mutation check runs in 4 parallel shards over 817 mutants (#45).

### Build and CI

* the mutation check runs in 4 parallel shards ([#46](https://github.com/mavrovde/viafrei-database/issues/46)) ([165f800](https://github.com/mavrovde/viafrei-database/commit/165f800b85aca9164c90a80c43d86d57dd977e36))

## [0.3.1](https://github.com/mavrovde/viafrei-database/compare/v0.3.0...v0.3.1) (2026-11-17)

0.3.0 was tagged but never published: its release job stopped on two surviving mutants, so no 0.3.0 image exists. 0.3.1 is the first published release of everything listed under 0.3.0 below, including the 0315 checks on the refresh requests (#41: anchor ids, the source list, and requested_by site, mcp or dev).

### Fixed

* the two mutants v0.3.0's release left alive are killed or removed ([#43](https://github.com/mavrovde/viafrei-database/issues/43)) ([40090d7](https://github.com/mavrovde/viafrei-database/commit/40090d7a85a5bf9117f39bf19e024ac0217f59c7))

## [0.3.0](https://github.com/mavrovde/viafrei-database/compare/v0.2.0...v0.3.0) (2026-11-17)


### Added

* every contract view reads the platform's tables and appends a licence envelope to each row (source_ref, source_refs, display_class, audience, confidentiality, terms gate, hold) (0312) ([c5018a9](https://github.com/mavrovde/viafrei-database/commit/c5018a91df042dda004463b9ff3b5e07fdf7fb50))
* schema live, the on-demand refresh requests the API records and the live ingestor claims and settles, with its own role viafrei_live_ingestor; public ids only, kept 30 days (0315) ([c5018a9](https://github.com/mavrovde/viafrei-database/commit/c5018a91df042dda004463b9ff3b5e07fdf7fb50))
* test-fixtures seed FILE writes contract.* inserts to the platform tables, so a consumer seeds its tests through this image ([c5018a9](https://github.com/mavrovde/viafrei-database/commit/c5018a91df042dda004463b9ff3b5e07fdf7fb50))
* the indexes the API's reads of the contract views need, built concurrently (0313) ([c5018a9](https://github.com/mavrovde/viafrei-database/commit/c5018a91df042dda004463b9ff3b5e07fdf7fb50))
* the schema head moves from 0306 to 0315 (nine migrations, 0307 to 0315) ([c5018a9](https://github.com/mavrovde/viafrei-database/commit/c5018a91df042dda004463b9ff3b5e07fdf7fb50))
* the source register, the curated driving rules with the low-emission zones, and the message coverage as data (0309 to 0311) ([c5018a9](https://github.com/mavrovde/viafrei-database/commit/c5018a91df042dda004463b9ff3b5e07fdf7fb50))
* train board ticks, domains.train_board_departures, day-partitioned and kept 14 days, and contract.train_board, each station's newest fetch (0314) ([c5018a9](https://github.com/mavrovde/viafrei-database/commit/c5018a91df042dda004463b9ff3b5e07fdf7fb50))
* viafrei-api's access store, schema access, and its writer role api_access (0308) ([c5018a9](https://github.com/mavrovde/viafrei-database/commit/c5018a91df042dda004463b9ff3b5e07fdf7fb50))
* viafrei-api's read contract, schema contract version 0.3, and its read-only role api_reader (0307) ([c5018a9](https://github.com/mavrovde/viafrei-database/commit/c5018a91df042dda004463b9ff3b5e07fdf7fb50))


### Fixed

* an existing API role with other attributes or a membership stops the migration before anything of it is applied ([c5018a9](https://github.com/mavrovde/viafrei-database/commit/c5018a91df042dda004463b9ff3b5e07fdf7fb50))


### Build and CI

* Snyk runs weekly on main and once per release, before publish ([#37](https://github.com/mavrovde/viafrei-database/issues/37)) ([78b1f31](https://github.com/mavrovde/viafrei-database/commit/78b1f319a71d1d88674e471e6ccbfe833d781b51))

## [0.2.0](https://github.com/mavrovde/viafrei-database/compare/v0.1.1...v0.2.0) (2026-11-15)


### Added

* a partial GiST index over the open weather warnings' planar area, built concurrently outside a transaction (0294) ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))
* a schema coverage gate: every function, trigger, view, constraint, policy, grant, role and partition rule is proved by a test here ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))
* domain tables for charging points, charging point status and hydrogen stations, road events, parking facilities and occupancy, weather warnings and road weather, road context features and webcams (0295 to 0301) ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))
* lint rule 6: from 0294, a migration that indexes or alters a table it did not create sets lock_timeout first, and migrate retries a lock timeout (55P03) ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))
* migrate applies the role settings to every database it migrates and exits 1 when they cannot be applied ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))
* new verbs and flags: partitions ensure --days-back and --from, roles passwords, and test-fixtures install behind VF_TEST_FIXTURES=1 ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))
* NOT NULL on the 20 domain columns a source must fill, and non-empty for the 17 text ones (0302) ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))
* past daily partitions on demand, tick BRIN indexes and a partition retention row for every tick table (0304, 0305) ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))
* road works carries the reader columns (0298) ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))
* the schema head moves from 0293 to 0306 (thirteen migrations, 0294 to 0306) ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))
* the schema's object comments, carried into every migrated database (0303) ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))


### Fixed

* the feed state fold counts every finished change (0306) ([7401cf6](https://github.com/mavrovde/viafrei-database/commit/7401cf693b0154d1ec7ccf9203b5d896183b1625))


### Build and CI

* build the release pull request only once the released version is tagged ([#13](https://github.com/mavrovde/viafrei-database/issues/13)) ([a92153a](https://github.com/mavrovde/viafrei-database/commit/a92153ab94e714ab1a4f49918914335d610d84a4))
* Scorecard runs weekly and on a branch-protection change, no longer on every push to main ([e09ee5f](https://github.com/mavrovde/viafrei-database/commit/e09ee5f7f949a5cb3d3a5f2efd089e25eb29abf9))
* the full mutation run is one pre-release job, and publish waits for it ([#36](https://github.com/mavrovde/viafrei-database/issues/36)) ([0d78599](https://github.com/mavrovde/viafrei-database/commit/0d7859913aaa795a80dd20ba910c1e995c283e0e))

## [0.1.1](https://github.com/mavrovde/viafrei-database/compare/v0.1.0...v0.1.1) (2026-11-13)


### Dependencies

* Bump typescript from 5.9.3 to 6.0.3 in the dev-tooling group ([#9](https://github.com/mavrovde/viafrei-database/issues/9)) ([3c099ff](https://github.com/mavrovde/viafrei-database/commit/3c099ff8eedf9011955c929cb6cdf5c1bdd40177))


### Build and CI

* release with release-please; the release workflow is started on the tag ([#10](https://github.com/mavrovde/viafrei-database/issues/10)) ([bafa043](https://github.com/mavrovde/viafrei-database/commit/bafa043997148061970cca404a89700ffcb5c6d3))

## [0.1.0] - 2026-11-13

The first public version.

### Added

- **The schema at version 0293, as one baseline.** `db/baseline/0293_baseline.sql`
  builds on an empty database (a plain `create database` on PostgreSQL 16
  with PostGIS 3.4 installed) what migrations 0001..0293 build, privileges
  included, and `db/baseline/ledger.tsv` records every version it
  stands for with its original name and SHA-256. On an empty database
  `migrate` applies the baseline and writes all 293 ledger rows in one
  transaction; a database that already holds them with equal checksums skips
  it.
- **Migration 0293, neutral texts.** The error hints, exception messages and
  run notes of eleven functions, and the notes of the two timetable feeds,
  say what they mean on their own. No behaviour changes. The file is carried
  beside the baseline, so a database at 0292 applies it and reaches the same
  ledger as an empty one.
- **The service.** One image, one long-lived `serve` process: it migrates
  under an advisory lock, creates the tick tables' daily partitions ahead,
  applies the service-role passwords, answers `/healthz` and `/ready` on 8080,
  and, when `DB_HOST` is set, serves a read-only diagnostics page with four
  safe, signed-in actions on 8090.
- **The commands.** `serve`, `migrate [--dry-run]`, `partitions ensure`,
  `check`, `head`, `status`, `analyze <table>`, `lint`, `export-migrations`,
  `version` and `ledger-compare`, each described in the README.
- **The release path.** An image is published to GHCR only from an annotated
  `vX.Y.Z` tag on `main` whose version equals `package.json` and whose CI
  and Security workflows concluded successfully. It is built for `linux/amd64` and `linux/arm64`, signed with cosign
  (keyless), attested with build provenance and an SPDX SBOM, pushed by
  digest, then pulled, verified and probed before any tag points at it.
- **The checks.** Lint (actionlint with shellcheck over the workflows
  included), unit tests, the migration lint, an integration test from an
  empty database to head under a coverage gate, the image build with a Trivy
  scan and a hardened start (the image ships no npm or npx), CodeQL,
  dependency review, gitleaks, a DAST run with OWASP ZAP, and the OpenSSF
  Scorecard.
- **The toolchain.** The image and CI run Node 26.13.0, the tests run on
  vitest 5.1.0, and the release and code-scanning steps use
  docker/login-action 4.8.0, sigstore/cosign-installer 4.1.3 and the CodeQL
  actions 4.39.3.
