# Security policy

## Reporting a vulnerability

Please do not report security issues in public issues, pull requests or
discussions. Use GitHub's
[private vulnerability reporting](https://github.com/mavrovde/viafrei-database/security/advisories/new).

- **Acknowledgement** within 3 working days.
- **Coordinated disclosure:** we publish an advisory once a fix is released,
  and at the latest 90 days after your report unless we agree another date
  with you.
- **Remediation targets** from confirmation: critical 2 days, high 7 days,
  medium 30 days, low with the next minor release.

Please describe a leaked credential or token by where you found it, not by
quoting it: a quoted secret in a report is one more copy of it.

## Supported versions

Until 1.0.0 only the newest release receives fixes.

## What is in scope

- the service and its two ports: readiness (`/healthz`, `/ready`) and the
  interface (the page, sign-in, the four actions);
- the container image as published;
- the migrations, for example a grant wider than its comment says, or a
  security-definer function that can be misused.

What the service promises is in the README's
[security model](README.md#security-model). A way around any of it is a
vulnerability.

## Automated checks

Each check, and what starts it:

| Check | Workflow | Runs on |
|---|---|---|
| type checking and linting | CI | every pull request and every push to `main` |
| unit tests and an integration test against PostGIS | CI | every pull request and every push to `main` |
| Trivy over the image | CI | every pull request and every push to `main` |
| CodeQL (SAST) | Security | every pull request, every push to `main`, and weekly |
| dependency review | Security | pull requests only (it compares a change with its base) |
| gitleaks over the full history | Security | every pull request, every push to `main`, and weekly |
| an OWASP ZAP baseline scan against the built container (DAST) | Security | every pull request, every push to `main`, and weekly |
| OpenSSF Scorecard | Scorecard | every push to `main`, weekly, and on a branch-protection change |

The CI workflow has no schedule. The CI, Security and Scorecard workflows can
also be started by hand.

Dependabot proposes dependency updates after a seven-day cooldown, for the
npm packages, the actions (each pinned by commit SHA) and the Dockerfile's
base image. A TypeScript release at or above the upper bound of
typescript-eslint's supported range (today 6.1.0) is not proposed; the bound
is kept equal to that range by a test and moves when typescript-eslint does.

### Images bumped by hand

These images are pinned by digest inside a `run:` line, a script or a service
container, where Dependabot does not look. Each one is updated by hand: a new
tag and its digest, in every place listed.

| Image | Used by | Where it is pinned |
|---|---|---|
| `rhysd/actionlint` | actionlint (with shellcheck) in the Lint job | `.github/workflows/ci.yml` |
| `aquasec/trivy` | the image scan | `.github/workflows/ci.yml` |
| `zricethezav/gitleaks` | the history scan | `.github/workflows/security.yml` |
| `zaproxy/zap-stable` | the DAST scan | `scripts/zap-scan.sh` |
| `postgis/postgis` | the integration test's service container, the smoke, the DAST scan and the baseline proof | `.github/workflows/ci.yml`, `scripts/image-smoke.sh`, `scripts/zap-scan.sh`, `scripts/baseline.sh` |
| `curlimages/curl` | the smoke's requests from outside the allow-list | `scripts/image-smoke.sh` |

Known advisory: GHSA-g3hv-75wg-m249 (minimatch, moderate) is reached only
through the lint tooling (eslint, typescript-eslint), a development dependency
that is not in the image (`npm prune --omit=dev`; `npm audit --omit=dev`
reports none).

Release images are signed with cosign (keyless) and carry a build-provenance
attestation and an SPDX SBOM; the README's
[Images and versions](README.md#images-and-versions) shows how to verify
them. An image that does not verify against that identity, or whose signing
commit is not on `main`, is not ours.

## Release tags

The release workflow always runs **on a tag, as it is in the tagged
commit**:

- **Started by release-please**, the normal path. Once the release pull
  request is merged and CI and Security have passed on its commit, the
  release-please workflow creates the annotated `vX.Y.Z` tag on that commit
  (through the API, with the workflow's built-in token; an existing tag is
  refused, never moved) and starts the release workflow on that tag
  (`workflow_dispatch` with `--ref vX.Y.Z`; a tag created with the built-in
  token starts no push workflow).
- **A tag a maintainer pushes**, or a release a maintainer starts again on its
  tag the same way.

Either way the certificate names `release.yml@refs/tags/vX.Y.Z`, and the
identity proves "the release workflow on a version tag", not "the workflow
on `main`". These controls close that gap:

- **Tag rulesets.** No one may move or delete a `v*` tag but a repository
  administrator (a ruleset on `refs/tags/v*` with the update, deletion and
  non-fast-forward rules and an admin-only bypass), and no one may create a
  `v*` tag with a suffix (`v*-*`, `v*+*`; no bypass). Creating a plain
  `vX.Y.Z` tag takes write access to the repository; the tag alone publishes
  nothing until the gate below has passed.
- **The commit must be on `main`, and be the run's own.** The workflow's gate
  refuses a run that is not on its tag, and a tag whose commit is not on
  `main` or is not the commit the run was started for (the one the
  certificate records). The verify job checks the signature and both
  attestations against that commit (`--certificate-github-workflow-sha`,
  `--source-digest`), and the README shows users how to check the signing
  commit against `main` themselves.

## The first release and the registry

Before an image is built, the release asks the registry whether `:X.Y.Z`
already exists, and asks again before tagging
(`scripts/ghcr-not-released.sh`). GHCR answers "denied" rather than "not
found" for a package that does not exist yet. "Denied" counts as "not
released" only when the packages API answers 404 for the package itself; a
package that exists, an unreadable API or any other answer stops the release.
