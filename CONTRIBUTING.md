# Contributing

Thank you for looking. This repository is the schema of the ViaFrei database
and the service that applies it. Changes reach `main` through a pull request
with green checks; `main` is squash-merged and linear.

## Running it

Node 26 (CI and the image run 26.13.0). For the integration test, an empty database in a PostGIS
16-3.4 cluster, made with a plain `create database` (not the image's `POSTGRES_DB`, which its init
fills with extensions no migration makes), and `psql` 16.

```bash
npm ci
psql postgresql://postgres:dev@127.0.0.1:5432/postgres -c 'create database empty'
npm run typecheck && npm run lint && npm test
TEST_DATABASE_URL=postgresql://postgres:dev@127.0.0.1:5432/empty npm run test:db
TEST_DATABASE_URL=postgresql://postgres:dev@127.0.0.1:5432/empty npm run coverage
scripts/image-smoke.sh
```

Every unit test runs in under two seconds. The from-empty integration test is
the one exception, and says so. `npm run coverage` runs both layers under the
coverage gate in `vitest.coverage.config.ts`; a figure below its threshold
fails. Lines and functions are held at 100 %: a statement no test can reach
carries `/* v8 ignore next */` with its reason on the line above, and a test
checks that every such comment has one.

## Writing a migration

Migrations are plain SQL in `db/migrations/NNNN_slug.sql`, numbered after
the baseline (`db/baseline/0293_baseline.sql`): the next is `0294`.
`db/migrations/0293_neutral_texts.sql` is the baseline's own newest version,
carried as a file so a database at 0292 can reach the head; its name and
bytes must stay those `ledger.tsv` records. `db/baseline/` (the baseline and
its `ledger.tsv`) is frozen; a change to the schema is always a new migration.
`db/baseline/aliases.tsv` is the one exception that grows: a version whose
file was edited in its comments only after the baseline was cut, and applied
in that form by a database migrated file by file, is listed there with the
checksum that database holds and the reason. `migrate`, readiness and
`ledger-compare` accept either checksum for that version; any other is still a
mismatch. `ledger.tsv` keeps the bytes the baseline was cut from, which is what
a database the baseline starts writes.
`npm run lint:migrations` enforces the rules below on every pull request:

1. **The next number, no gap.** The prefix is four digits and the slug starts
   with a lower-case letter, digit or underscore (the shell glob
   `[0-9][0-9][0-9][0-9]_[a-z0-9_]*.sql`); keep the whole slug lower case.
2. **Never edit an applied file.** The ledger stores each file's SHA-256, and
   an edited file stops every later migrate. Write the next number instead.
3. **End with a rollback note.** A `-- rollback:` comment says how to undo the
   file. It must include the statement that deletes the file's own ledger row
   (`delete from schema_migrations where version = N;`), or say
   `irreversible:` and what a restore needs.
4. **End with a newline.**
5. **`concurrently` needs its own line.** PostgreSQL refuses
   `create index concurrently` inside a transaction. A file that runs it
   carries a `-- no-transaction: <why>` line within its first 20 lines, and
   every statement in it is idempotent (`if not exists` / `or replace`),
   because such a file can half-apply and be retried from the top.

Schema conventions:

- `timestamptz` only, stored in UTC;
- `numeric` for money, never a float;
- `geography(Point,4326)` with a GiST index for locations;
- plural snake_case table names.

Tick tables are append-only and partitioned by day on `observed_at`, with
**no** default partition: a tick outside the covered days is refused loudly
instead of being parked where nothing looks. `ensure_daily_partitions` keeps
them ahead, and `check` and `/ready` require today and tomorrow covered.

## Pull requests

- Use one topic per pull request, and a Conventional Commit title (`feat:`,
  `fix:`, `docs:`, `deps:`, `ci:`…). Pull requests are squashed, so the title
  becomes the commit on `main`, and the commits on `main` decide the next
  version: release-please reads them and keeps a release pull request open
  with the version bump and the `CHANGELOG.md` section. While the version is
  `0.x`, `feat:` raises the minor and `fix:` the patch; `feat!:` or a
  `BREAKING CHANGE:` footer raises the minor too. `docs:`, `deps:`, `ci:`,
  `build:`, `perf:`, `refactor:` and `revert:` are listed in the changelog
  and raise the patch; `test:`, `chore:` and `style:` are left out and
  release nothing on their own.
- Do not edit a released section of `CHANGELOG.md` or the version in
  `package.json` by hand; the release pull request writes both.
- For a migration that adds a query path, include the `EXPLAIN (ANALYZE,
  BUFFERS)` of the query it serves.
- Issues and pull requests use four labels: `type:bug`, `type:feature`,
  `dependencies` and `documentation`. release-please adds its own
  `autorelease: pending` and `autorelease: tagged` to the release pull request.
- Never put a real credential, host, address or production figure in a commit,
  a comment or a test fixture. The secret scan reads the whole history.

## Releases

A merged release pull request releases by itself (README,
[Images and versions](README.md#images-and-versions)). One setting is made
once, and when a release stops on the way one of the cases below applies.

**Setup.** The repository allows GitHub Actions to create pull requests
(Settings, Actions, General, Workflow permissions: "Allow GitHub Actions to
create and approve pull requests"), because release-please opens the release
pull request with the workflow's built-in token; this is low risk here because
`main` requires 0 approving reviews, so an approval by the token unlocks
nothing, and `release-please.yml` is the only workflow granted
`pull-requests: write`. Releases are serialised in one concurrency group: a
running release is never cancelled, but a release still pending behind it is
replaced by a newer pending one, so start one release at a time.

**The mutation tally.** The release workflow runs every mutant of
`npm run mutate` on the tagged commit, after the gate and before anything is
built, in four parallel Mutation shard jobs (`--shard k/4` takes the mutants at
the positions p with p mod 4 = k - 1, so the four are disjoint and together the
whole set; test/mutants.test.ts proves it), each with its own controls and a
120-minute limit, gathered by the Mutation check job that the build waits for.
A survivor in any shard, a shard that does not finish, a mutant whose pattern no longer matches
or matches more than one place (test/mutants.test.ts refuses both first), or a unit or database run that fails before any mutant is planted (each
distinct run is made once, unmutated, first) stops the release. That run is
the tally: there is no separate local run of the full set before a release,
and no pull request or push runs it. A pull request that adds or changes a
mutant proves it with `npm run mutate -- --only <text>`. A release stopped by
a survivor is the last case below: the fault is in the tagged commit.

**When a release stops.** A version tag is never reused, moved or deleted, so
which recovery applies depends on how far the release got:

- **Nothing published yet** (no `:X.Y.Z` image tag; the gate, the mutation
  check (a timeout, not a survivor), the build, the push or the verification
  failed for a reason outside the tagged commit, such as a registry or runner
  outage): start the release again on its tag,
  `gh workflow run release.yml --ref vX.Y.Z`. The gate runs again in full. A
  run on the same tag repeats the same time limit and the same four shards, so
  a mutation shard that times out again on that commit needs a new patch
  release with more shards or a higher `timeout-minutes`; a tag is never
  reused.
- **The image is tagged but the release page is not published** (the
  `release-page` job failed): re-run only the failed job of that run,
  `gh run rerun <run-id> --failed`. A new run would be refused, because
  `:X.Y.Z` exists and a release is never re-tagged.
- **The release-please run could not find the release run** (its tag job
  failed waiting, or the release run was cancelled while it was pending): if
  no release run on the tag ran to the end, start it on the tag as in the
  first case.
- **The tag job failed before the tag existed** (a check of the release
  commit, or creating the tag): no release pull request is built until the
  tag exists, because release-please would otherwise count from bootstrap-sha
  (the 0.1.0 commit) and list released changes again. Fix the cause and re-run
  the failed job, `gh run rerun <run-id> --failed`; it creates the tag, starts
  the release on it and builds the next release pull request.
- **The tag job failed after the tag existed, before release.yml started**
  (reading the tag back, or the dispatch): a re-run of the tag job is refused,
  because the tag exists. Start the release on the tag,
  `gh workflow run release.yml --ref vX.Y.Z`. The next push to main builds the
  release pull request, or start it now with
  `gh workflow run release-please.yml --ref main`.
- **Snyk stopped the release** (the Snyk (dependencies) job failed, nothing is
  built): a Snyk outage (the CLI download, the API, a timeout) means start the
  release again on its tag, as in the first case; an advisory (high or
  critical) means fix it on `main` and release a new patch; an exhausted
  free-plan monthly test quota fails like an advisory, and is not forced
  through.
- **The fault is in the tagged commit itself** (the version, the schema head
  or a check of the image is wrong): none of the above; fix it on `main` and
  release a new patch. The failed tag still counts for `:latest` and `:X.Y`.

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
