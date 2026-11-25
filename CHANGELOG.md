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

## [0.7.0](https://github.com/mavrovde/viafrei-database/compare/v0.6.1...v0.7.0) (2026-11-25)


### Added

* migrations 0347-0351 (api_reader grants, car-park notes, charging register, road-event entry records) ([#118](https://github.com/mavrovde/viafrei-database/issues/118)) ([8b87052](https://github.com/mavrovde/viafrei-database/commit/8b87052c710a3d9e32eb51b230f9a9cee54677be))

## [0.6.1](https://github.com/mavrovde/viafrei-database/compare/v0.6.0...v0.6.1) (2026-11-25)


### Changed

* **index:** road_events_open_geom, a GiST index on the open road events (0346) ([#116](https://github.com/mavrovde/viafrei-database/issues/116)) ([e610575](https://github.com/mavrovde/viafrei-database/commit/e610575020351fdf4c0fb31a6ca7096fc832f2c4))

## [0.6.0](https://github.com/mavrovde/viafrei-database/compare/v0.5.3...v0.6.0) (2026-11-24)


### Added

* **grants:** api_reader reads the seven relations and the function today's MCP answers use (0345) ([#115](https://github.com/mavrovde/viafrei-database/issues/115)) ([4fe1028](https://github.com/mavrovde/viafrei-database/commit/4fe1028b2ee9b208fdb85aa244ce8be6fa3908c8))


### Fixed

* **db:** the SIRI latest table keeps half of every page free, so a delay update stays HOT (0344) ([#113](https://github.com/mavrovde/viafrei-database/issues/113)) ([dea6c17](https://github.com/mavrovde/viafrei-database/commit/dea6c1750b31e8e79e71291d025ab1edab4e38a8))

## [0.5.3](https://github.com/mavrovde/viafrei-database/compare/v0.5.2...v0.5.3) (2026-11-24)


### Fixed

* **db:** register rows for hydrogen, Flix and city roads feeds; Trip Updates in transit (0342, 0343) ([#111](https://github.com/mavrovde/viafrei-database/issues/111)) ([da49361](https://github.com/mavrovde/viafrei-database/commit/da49361d9948909ce406ee7b1f718bfa7ee38579))

## [0.5.2](https://github.com/mavrovde/viafrei-database/compare/v0.5.1...v0.5.2) (2026-11-24)


### Changed

* **db:** 0340 drops the SIRI ET latest _next index, 0341 builds stop_times_stop again ([#107](https://github.com/mavrovde/viafrei-database/issues/107)) ([8be8ecb](https://github.com/mavrovde/viafrei-database/commit/8be8ecbe02ec69d49f2edd3800cc53aeac705558))

## [0.5.1](https://github.com/mavrovde/viafrei-database/compare/v0.5.0...v0.5.1) (2026-11-24)


### Fixed

* **0339:** every SECURITY DEFINER and trigger function pins a search_path naming pg_temp; archived autobahn_events days restore again ([#105](https://github.com/mavrovde/viafrei-database/issues/105)) ([2b29aad](https://github.com/mavrovde/viafrei-database/commit/2b29aad23d43fcc7edfacfa88282e1258ad27006))

## [0.5.0](https://github.com/mavrovde/viafrei-database/compare/v0.4.5...v0.5.0) (2026-11-23)


### Added

* **db:** 0336 grants api_reader the base tables the contract views read ([#101](https://github.com/mavrovde/viafrei-database/issues/101)) ([f55a088](https://github.com/mavrovde/viafrei-database/commit/f55a0880b948294a46074a164589ce23ab8400be))


### Changed

* **api:** 0337 the indexes of the API's reads on the platform's tables, and api_reader's data_status read ([#103](https://github.com/mavrovde/viafrei-database/issues/103)) ([d922963](https://github.com/mavrovde/viafrei-database/commit/d9229635c7ccd51fb1e9ba869db537912294aba7))
* **api:** 0338 stores a road event's Land at write time, and indexes the energy summary's point count ([#104](https://github.com/mavrovde/viafrei-database/issues/104)) ([11542e6](https://github.com/mavrovde/viafrei-database/commit/11542e6d6325c09adbe8e5f5c10bdc04d63d9472))

## [0.4.5](https://github.com/mavrovde/viafrei-database/compare/v0.4.4...v0.4.5) (2026-11-23)


### Fixed

* **db:** 0335 lets viafrei_mcp read traffic_count_sites_live and gives road_events_current entry_static ([#99](https://github.com/mavrovde/viafrei-database/issues/99)) ([e338b4b](https://github.com/mavrovde/viafrei-database/commit/e338b4b1d3881ab5e60d4b6de7f207808c99e1d3))

## [0.4.4](https://github.com/mavrovde/viafrei-database/compare/v0.4.3...v0.4.4) (2026-11-23)


### Changed

* **charging:** 0331 stores the twin claims at write time ([c3be36e](https://github.com/mavrovde/viafrei-database/commit/c3be36e523155fa33b2085f7a88adb3decb553f6))
* **db:** 0332 gives the planner the EVSE expression statistics, the lorry contract geography indexes, drops two unused SIRI ET stop indexes, and adds the traffic_count_sites_live view read by viafrei_digest ([c3be36e](https://github.com/mavrovde/viafrei-database/commit/c3be36e523155fa33b2085f7a88adb3decb553f6))
* **db:** 0333 sets autovacuum and autoanalyze for the small hot state tables ([c3be36e](https://github.com/mavrovde/viafrei-database/commit/c3be36e523155fa33b2085f7a88adb3decb553f6))
* **db:** 0334 keys parking_occupancy_sid by the facility sid and observation time ([c3be36e](https://github.com/mavrovde/viafrei-database/commit/c3be36e523155fa33b2085f7a88adb3decb553f6))
* **db:** the road readers' per-row values stored, a single-pass validity parse (0330) ([#93](https://github.com/mavrovde/viafrei-database/issues/93)) ([70b694a](https://github.com/mavrovde/viafrei-database/commit/70b694affdc16cdc17b97e3a20ca505a13b8abec))

## [0.4.3](https://github.com/mavrovde/viafrei-database/compare/v0.4.2...v0.4.3) (2026-11-22)


### Changed

* **db:** a German-only weather view and analysed autobahn_events days (0328, 0329) ([#92](https://github.com/mavrovde/viafrei-database/issues/92)) ([a3eec0c](https://github.com/mavrovde/viafrei-database/commit/a3eec0c6cf581dd168d7046f45d12f7bca3572b8))
* **db:** index the live VBN Connect stops by position (0327) ([#90](https://github.com/mavrovde/viafrei-database/issues/90)) ([e67767f](https://github.com/mavrovde/viafrei-database/commit/e67767f8132207cedcf66b505cc41cbec91371d9))

## [0.4.2](https://github.com/mavrovde/viafrei-database/compare/v0.4.1...v0.4.2) (2026-11-22)


### Build and CI

* **release:** twenty mutation shards, each planning 8 of its 15 minutes ([#82](https://github.com/mavrovde/viafrei-database/issues/82)) ([ec4ffbd](https://github.com/mavrovde/viafrei-database/commit/ec4ffbdadf26e81817f7fec195a040f337f74239))

## [0.4.1](https://github.com/mavrovde/viafrei-database/compare/v0.4.0...v0.4.1) (2026-11-22)


### Changed

* **db:** 0323-0326, production's hand changes and the charging twin pairs ([#70](https://github.com/mavrovde/viafrei-database/issues/70)) ([9262270](https://github.com/mavrovde/viafrei-database/commit/92622705e3a8f77c235dce786ad870bc52e032fd))

## [0.4.0](https://github.com/mavrovde/viafrei-database/compare/v0.3.4...v0.4.0) (2026-11-20)


### Added

* the database owns its maintenance (0322, partitions retain, reclaim) ([#60](https://github.com/mavrovde/viafrei-database/issues/60)) ([09c1af4](https://github.com/mavrovde/viafrei-database/commit/09c1af43376898cac4991ff3b08f4017c9959094))


### Changed

* **db:** production's 2026-11-19 hand changes as migrations 0319-0321 (GiST, lz4, role memory) ([#58](https://github.com/mavrovde/viafrei-database/issues/58)) ([134c816](https://github.com/mavrovde/viafrei-database/commit/134c816e84f82f859b9a8e567fa1d03548b97c8c))


### Dependencies

* Bump minimatch, eslint and typescript-eslint ([#42](https://github.com/mavrovde/viafrei-database/issues/42)) ([2400c2c](https://github.com/mavrovde/viafrei-database/commit/2400c2c733d793d372ec1c02a076a766760a820e))

## [0.3.4](https://github.com/mavrovde/viafrei-database/compare/v0.3.3...v0.3.4) (2026-11-19)


### Changed

* **db:** feed_ts index on vrn_transit_delays for the freshness probe ([#56](https://github.com/mavrovde/viafrei-database/issues/56)) ([12dfb5e](https://github.com/mavrovde/viafrei-database/commit/12dfb5e72169f001f353146357e98260a2f3789b))
* **db:** indexes for the open road-events read and the station-facilities location read ([#54](https://github.com/mavrovde/viafrei-database/issues/54)) ([84c0d05](https://github.com/mavrovde/viafrei-database/commit/84c0d057bd0846c86cbed6c1a21e816c58731efe))

## [0.3.3](https://github.com/mavrovde/viafrei-database/compare/v0.3.2...v0.3.3) (2026-11-18)


### Changed

* **contract:** station_facility looks a stop place up by an index range, road computes no shape a read does not ask for ([#49](https://github.com/mavrovde/viafrei-database/issues/49)) ([#50](https://github.com/mavrovde/viafrei-database/issues/50)) ([3315bee](https://github.com/mavrovde/viafrei-database/commit/3315bee39ace24b137ee1eb5981e177041a24824))

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
