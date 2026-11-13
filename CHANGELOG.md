# Changelog

All notable changes to this project are written here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) for the database
service (`package.json`).

## [Unreleased]

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

### Changed

- **Dependencies.** The image and CI run Node 26.13.0; the tests run on
  vitest 5.1.0; docker/login-action 4.8.0, sigstore/cosign-installer 4.1.3
  and the CodeQL actions 4.39.3.
