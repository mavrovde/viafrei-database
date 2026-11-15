/**
 * Mutation check: each mutant is one small, plausible bug — in the head and
 * readiness logic, the schema coverage gate, the consumer verbs, the lint, the
 * migrations and the baseline (the schema behaviour mutants of
 * scripts/mutants-schema-behaviour.ts: functions, triggers, views). The tests
 * named for it must fail on every one of them, or they do not guard what they
 * claim to. The file is restored after
 * each mutant, also on an interrupted run.
 *
 *   npm run mutate                       every mutant
 *   npm run mutate -- --only <text>      the mutants whose name contains <text>
 *
 * A mutant with `config: DB` (every schema behaviour mutant has it) runs its
 * tests with vitest.db.config.ts and VF_REQUIRE_DB=1, so it needs
 * TEST_DATABASE_URL (and psql) like `npm run test:db` and cannot pass by being
 * skipped; each such run migrates its own database.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_BEHAVIOUR_MUTANTS } from "./mutants-schema-behaviour.js";

const ROOT = join(import.meta.dirname, "..");
const FILE = join(ROOT, "src", "migrations", "plan.ts");
const TESTS = ["test/plan.test.ts", "test/service.test.ts", "test/http.test.ts", "test/actions.test.ts"];

type Mutant = { readonly name: string; readonly from: string; readonly to: string; readonly file?: string; readonly tests?: readonly string[]; readonly config?: string };
const DB = "vitest.db.config.ts";
const at = (...p: string[]): string => join(ROOT, ...p);
const GATE = join(ROOT, "scripts", "coverage-schema.ts");
const GATE_TESTS = ["test/coverage-schema.test.ts"];
const MUTANTS: readonly Mutant[] = [
  { name: "an unreadable ledger counts as ready", from: 'if (state === null) return { ready: false, reason: "no-ledger"', to: 'if (state === null) return { ready: true, reason: "at-head", head: 0 }; if (Math.random() < 0) return { ready: false, reason: "no-ledger"' },
  { name: "an image without migrations is ready", from: "if (state.imageHead === 0)", to: "if (state.imageHead < 0)" },
  { name: "a mismatch does not block readiness", from: "if (state.mismatches.length > 0) {", to: "if (state.mismatches.length > 1) {" },
  { name: "pending files do not block readiness", from: "if (state.pending.length > 0) {", to: "if (state.pending.length > 1) {" },
  { name: "a file with another checksum counts as applied", from: "} else if (!acceptsChecksum(f, got)) {", to: "} else if (got === undefined) {" },
  { name: "a gap is not pending", from: "      pending.push(f);", to: "      if (f.version > rows.reduce((m, r) => Math.max(m, r.version), 0)) pending.push(f);" },
  { name: "the image head is the file count, not the highest version", from: "const imageHead = files.reduce((m, f) => Math.max(m, f.version), 0);", to: "const imageHead = files.length - 1;" },
  { name: "ahead versions block readiness", from: "const ahead = [...byVersion.keys()].filter((v) => !carried.has(v)).sort((a, b) => a - b);", to: "const ahead = [...byVersion.keys()].filter((v) => !carried.has(v)).sort((a, b) => a - b); if (ahead.length > 0 && files[0]) pending.push(files[0]);" },
  { name: "the partitions step is not required", from: 'if (steps.partitions === null) return { ready: false, detail: "partitions not ensured yet" };', to: "" },
  { name: "a failed partitions step counts as done", from: 'if (!steps.partitions) return { ready: false, detail: "partitions ensure failed" };', to: "" },
  { name: "the role step is not required", from: 'if (steps.roles === null) return { ready: false, detail: "role passwords not applied yet" };', to: "" },
  { name: "a failed role step counts as done", from: 'if (steps.roles === false) return { ready: false, detail: "a required role password could not be applied" };', to: "" },
  { name: "the schema is not required", from: "if (!schema.ready) return", to: "if (Math.random() < 0) return" },
  { name: "gate: an object without a row is not missing", file: GATE, tests: GATE_TESTS, from: "!named.has(key(o)) && !gapped.has(key(o)));", to: "false);" },
  { name: "gate: a row for no object is not stale", file: GATE, tests: GATE_TESTS, from: "manifest.filter((r) => !objects.has(key(r)));", to: "manifest.filter(() => false);" },
  { name: "gate: a row naming no test passes", file: GATE, tests: GATE_TESTS, from: "!(tests.get(r.file)?.has(r.title) ?? false)", to: "!tests.has(r.file)" },
  { name: "gate: the gap may keep a covered row", file: GATE, tests: GATE_TESTS, from: "objects.has(key(r)) && named.has(key(r))", to: "false" },
  { name: "gate: the gap may keep a vanished row", file: GATE, tests: GATE_TESTS, from: "gap.filter((r) => !objects.has(key(r)));", to: "gap.filter(() => false);" },
  { name: "gate: an unreadable test tree is an error, not a refusal", file: GATE, tests: GATE_TESTS, from: "throw new Refusal(`the test listing could not read", to: "throw new Error(`the test listing could not read" },
  { name: "gate: a kind read as none passes", file: GATE, tests: GATE_TESTS, from: "if (!catalogue.some((o) => o.kind === k)) throw", to: "if (catalogue.length < 0) throw" },
  { name: "gate: an empty manifest passes", file: GATE, tests: GATE_TESTS, from: "if (manifest.length === 0) throw", to: "if (manifest.length < 0) throw" },
  { name: "gate: a malformed row is skipped", file: GATE, tests: GATE_TESTS, from: "throw new Refusal(`${where}:${String(i + 1)}: expected", to: "return; throw new Refusal(`${where}:${String(i + 1)}: expected" },
  { name: "gate: a test listing with no title passes", file: GATE, tests: GATE_TESTS, from: "if (out.size === 0 || n === 0) throw", to: "if (out.size < 0) throw" },
  { name: "gate: a title built at run time is listed", file: GATE, tests: GATE_TESTS, from: "|\\\\.|\\$(?!\\{))*)`)/g;", to: "|\\\\.|\\$)*)`)/g;" },
  { name: "gate: the ok verdict ignores unknown tests", file: GATE, tests: GATE_TESTS, from: "stale.length + unknownTests.length + staleGap.length", to: "stale.length + staleGap.length" },
  // #31: the consumer verbs and what they apply.
  { name: "cli: --days-back and --from are both taken", file: at("src", "cli.ts"), tests: ["test/cli.test.ts"], from: 'if (seen.has("--days-back") && seen.has("--from")) return', to: "if (seen.size < 0) return" },
  { name: "cli: roles passwords without VF_DB_ROLE_DIR runs", file: at("src", "cli.ts"), tests: ["test/cli-verbs.test.ts"], from: 'rest[0] === "passwords" && config.roleSecretDir === null', to: 'rest[0] === "passwords" && config.roleSecretDir === "x"' },
  { name: "cli: a roles sub-verb that is neither is taken", file: at("src", "cli.ts"), tests: ["test/cli.test.ts"], from: '(rest[0] !== "settings" && rest[0] !== "passwords")', to: "false" },
  { name: "partitions: --from takes a date that is not on the calendar", file: at("src", "partitions.ts"), tests: ["test/partitions.test.ts", "test/cli.test.ts"], from: ".toISOString().slice(0, 10) === raw;", to: ".getTime() > 0;" },
  { name: "partitions: the days back are not passed", file: at("src", "partitions.ts"), tests: ["test/partitions.test.ts"], from: "return `select ensure_daily_partitions(${String(days)}, ${String(back.days)});`;", to: "return `select ensure_daily_partitions(${String(days)});`;" },
  { name: "partitions: a back count past the bound is taken", file: at("src", "partitions.ts"), tests: ["test/partitions.test.ts"], from: "back.days < 0 || back.days > MAX_DAYS", to: "back.days < 0" },
  { name: "roles: a failed settings run counts as applied", file: at("src", "roles.ts"), tests: ["test/roles.test.ts"], from: "  if (r.code !== 0) {\n    const first", to: "  if (r.code < 0) {\n    const first" },
  { name: "roles: a settings file with no statement counts as applied", file: at("src", "roles.ts"), tests: ["test/roles.test.ts"], from: "if (n === 0) return { ok: false", to: "if (n < 0) return { ok: false" },
  { name: "settings.sql: a role setting is dropped", file: at("db", "roles", "settings.sql"), tests: ["test/roles.test.ts"], from: "DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET jit TO ''off''', current_database()); END $$;\n", to: "" },
  { name: "db: migrate does not apply the role settings", config: DB, file: at("src", "service.ts"), tests: ["test/consumer.db.test.ts"], from: "if (r.exitCode === 0 && !dryRun) {", to: "if (r.exitCode === 0 && dryRun) {" },
  { name: "db: a dry run applies the role settings", config: DB, file: at("src", "service.ts"), tests: ["test/consumer.db.test.ts"], from: "if (r.exitCode === 0 && !dryRun) {", to: "if (r.exitCode === 0) {" },
  { name: "db: 0304 ignores days_back", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/consumer.db.test.ts"], from: "for i in -days_back..days_ahead loop", to: "for i in -3..days_ahead loop" },
  { name: "db: 0304 takes a negative days_back", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/consumer.db.test.ts"], from: "days_back is null or days_back < 0 or days_back > 400", to: "days_back is null or days_back > 400" },
  { name: "db: 0303 loses the feed_runs.status comment", config: DB, file: at("db", "migrations", "0303_carried_comments.sql"), tests: ["test/consumer.db.test.ts"], from: "COMMENT ON COLUMN public.feed_runs.status IS", to: "SELECT 'public.feed_runs.status' IS NOT NULL OR" },
  // #32: the service roles and their grants, against test/acl/expected.tsv and test/acl/consumers.tsv.
  { name: "db: expected.tsv loses a grant the catalogue holds", config: DB, file: at("test", "acl", "expected.tsv"), tests: ["test/roles-grants.db.test.ts"], from: "viafrei_mcp\trelation\tpublic.autobahn_events\tSELECT\n", to: "" },
  { name: "db: expected.tsv names a privilege nobody holds", config: DB, file: at("test", "acl", "expected.tsv"), tests: ["test/roles-grants.db.test.ts"], from: "viafrei_ops\trelation\tpublic.error_events\tSELECT\n", to: "viafrei_ops\trelation\tpublic.error_events\tSELECT,UPDATE\n" },
  { name: "db: a migration grants a forbidden relation", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/roles-grants.db.test.ts"], from: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\n", to: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\ngrant select on public.deployments to viafrei_digest;\n" },
  { name: "db: the ACL read leaves out column grants", config: DB, file: at("test", "acl.ts"), tests: ["test/roles-grants.db.test.ts"], from: "cross join lateral aclexplode(att.attacl) a", to: "cross join lateral aclexplode(att.attacl) a where false" },
  { name: "db: the consumer list claims a write the role has not", config: DB, file: at("test", "acl", "consumers.tsv"), tests: ["test/roles-grants.db.test.ts"], from: "viafrei_status\tpublic.deployments\tselect\t", to: "viafrei_status\tpublic.deployments\tinsert:id\t" },
  // #32 checks: the table both ways, and each plant refused by its own check alone.
  { name: "db: constraints.tsv loses a check the catalogue holds", config: DB, file: at("test", "checks", "constraints.tsv"), tests: ["test/checks.db.test.ts"], from: 'control.shares\tshares_floor_cap\tCHECK ((floor <= cap))\t{"floor":"5","cap":"4"}\n', to: "" },
  { name: "db: a plant the check allows", config: DB, file: at("test", "checks", "constraints.tsv"), tests: ["test/checks.db.test.ts"], from: '\tCHECK ((floor <= cap))\t{"floor":"5","cap":"4"}', to: '\tCHECK ((floor <= cap))\t{"floor":"4","cap":"5"}' },
  { name: "db: a migration loosens a check", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/checks.db.test.ts"], from: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\n", to: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\nalter table control.shares drop constraint shares_floor_cap;\nalter table control.shares add constraint shares_floor_cap check (floor <= cap + 1);\n" },
  { name: "db: a plant keeps the other checks", config: DB, file: at("test", "checks.ts"), tests: ["test/checks.db.test.ts"], from: "and (conname <> $2 or $3) and coninhcount = 0", to: "and false and coninhcount = 0" },
  { name: "db: a plant keeps the triggers enabled ALWAYS", config: DB, file: at("test", "checks.ts"), tests: ["test/checks.db.test.ts"], from: "  await c.query(`alter table ${relation} disable trigger user`);\n", to: "" },
  { name: "db: the lifted control keeps the check", config: DB, file: at("test", "checks.ts"), tests: ["test/checks.db.test.ts"], from: "lift ? null : check)", to: "check)" },
  // #32 partitioned + retention.
  { name: "db: partitions/expected.tsv loses a partitioned table", config: DB, file: at("test", "partitions", "expected.tsv"), tests: ["test/partitioned.db.test.ts"], from: "public.los_ticks\tRANGE (observed_at)\tlos_ticks_brin\tarchive:14\n", to: "" },
  { name: "db: partitions/expected.tsv moves a no-archive tick to the archive", config: DB, file: at("test", "partitions", "expected.tsv"), tests: ["test/partitioned.db.test.ts"], from: "public.vbn_siri_et_calls\tRANGE (observed_at)\tvbn_siri_et_calls_brin\tdrop:1\n", to: "public.vbn_siri_et_calls\tRANGE (observed_at)\tvbn_siri_et_calls_brin\tarchive:14\n" },
  { name: "db: a migration gives a tick a default partition", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/partitioned.db.test.ts"], from: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\n", to: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\ncreate table public.fuel_prices_default partition of public.fuel_prices default;\n" },
  { name: "db: a migration drops a tick's BRIN", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/partitioned.db.test.ts"], from: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\n", to: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\ndrop index public.transit_delays_brin;\n" },
  { name: "db: the archive ledger takes a day twice", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/partitioned.db.test.ts"], from: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\n", to: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\nalter table public.partition_archives drop constraint partition_archives_table_day;\n" },
  { name: "db: 0304 makes the window one day shorter back", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/partitioned.db.test.ts"], from: "perform public.ensure_daily_partitions(days_ahead, 3);", to: "perform public.ensure_daily_partitions(days_ahead, 2);" },
  // #31 round 2: the ledger read-back, the database-wide setting, 0305.
  { name: "migrate: a file is not read back from the ledger", file: at("src", "migrations", "migrate.ts"), tests: ["test/migrate.test.ts"], from: " ?? (await reached(f.name, [f]));", to: ";" },
  { name: "db: migrate takes a file that quit psql as applied", config: DB, file: at("src", "migrations", "migrate.ts"), tests: ["test/migrate-ledger.db.test.ts"], from: " ?? (await reached(f.name, [f]));", to: ";" },
  { name: "migrate: a read-back counts a missing version as present", file: at("src", "migrations", "migrate.ts"), tests: ["test/migrate.test.ts"], from: "want.find((w) => !sums.has(w.version))", to: "want.find((w) => !sums.has(w.version) && false)" },
  { name: "settings.sql: the database-wide search_path is dropped", file: at("db", "roles", "settings.sql"), tests: ["test/roles.test.ts"], from: "DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path TO \"$user\", public, topology, tiger', current_database()); END $$;\n", to: "" },
  { name: "db: migrate applies no database-wide setting", config: DB, file: at("db", "roles", "settings.sql"), tests: ["test/consumer.db.test.ts"], from: "EXECUTE format('ALTER DATABASE %I SET search_path TO \"$user\", public, topology, tiger', current_database());", to: "PERFORM 1;" },
  { name: "db: 0305 keeps fuel_prices 14 days", config: DB, file: at("db", "migrations", "0305_tick_brin_and_public_retention.sql"), tests: ["test/partitioned.db.test.ts"], from: "('public', 'fuel_prices', 28, true,", to: "('public', 'fuel_prices', 14, true," },
  { name: "db: 0305 leaves los_ticks without its BRIN", config: DB, file: at("db", "migrations", "0305_tick_brin_and_public_retention.sql"), tests: ["test/partitioned.db.test.ts"], from: "CREATE INDEX los_ticks_brin ON public.los_ticks USING brin (observed_at);\n", to: "" },
  // #32 tables and policies.
  { name: "db: a migration drops a unique constraint", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/tables.db.test.ts"], from: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\n", to: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\nalter table domains.parking_occupancy drop constraint parking_occupancy_owner_key;\n" },
  { name: "db: a migration lifts a NOT NULL", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/tables.db.test.ts"], from: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\n", to: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\nalter table control.callers alter column caller drop not null;\n" },
  { name: "db: a migration drops a foreign key", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/tables.db.test.ts"], from: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\n", to: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\nalter table control.providers drop constraint providers_budget_key_fkey;\n" },
  { name: "db: a migration opens an own-insert policy", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/policies.db.test.ts"], from: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\n", to: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\nalter policy parking_occupancy_own_insert on domains.parking_occupancy with check (true);\n" },
  { name: "db: a migration drops an own-update policy", config: DB, file: at("db", "migrations", "0304_partitions_days_back.sql"), tests: ["test/policies.db.test.ts"], from: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\n", to: "  perform public.ensure_daily_partitions(days_ahead, 3);\nend $$;\ndrop policy charging_points_own_update on domains.charging_points;\n" },
  { name: "db: the key test inserts its row once", config: DB, file: at("test", "tables.db.test.ts"), tests: ["test/tables.db.test.ts"], from: "if (k.type !== \"f\") await y.query", to: "if (false) await y.query" },
  { name: "db: the key test keeps the foreign keys in replica mode", config: DB, file: at("test", "tables.db.test.ts"), tests: ["test/tables.db.test.ts"], from: "fks: k.type === \"f\" }", to: "fks: false }" },
  { name: "db: the null test keeps no NOT NULL", config: DB, file: at("test", "tables.db.test.ts"), tests: ["test/tables.db.test.ts"], from: "[col], null))({ [col]: null })", to: "[], null))({ [col]: null })" },
  { name: "db: a partition index is not resolved to its key", config: DB, file: at("test", "tables.db.test.ts"), tests: ["test/tables.db.test.ts"], from: "return r.rows[0]?.p ?? name;", to: "return name;" },
  { name: "db: a self-referencing key plants no row of its own", config: DB, file: at("test", "tables.db.test.ts"), tests: ["test/tables.db.test.ts"], from: "k.type === \"f\" && k.self ?", to: "false ?" },
  // #31 item 7: the memory bound.
  { name: "the readers' bound gives MCP a third node", file: at("db", "roles", "settings.sql"), tests: ["test/memory-bound.test.ts"], from: "viafrei_mcp connections=18 work_mem_mb=16 hash_mem_multiplier=1 nodes=2", to: "viafrei_mcp connections=18 work_mem_mb=16 hash_mem_multiplier=1 nodes=3" },
  { name: "MCP's work_mem moves without its bound", file: at("db", "roles", "settings.sql"), tests: ["test/memory-bound.test.ts"], from: "ALTER ROLE viafrei_mcp IN DATABASE %I SET work_mem TO ''16MB''", to: "ALTER ROLE viafrei_mcp IN DATABASE %I SET work_mem TO ''32MB''" },
  { name: "the owner's maintenance_work_mem moves without its bound", file: at("db", "roles", "settings.sql"), tests: ["test/memory-bound.test.ts"], from: "SET maintenance_work_mem TO ''64MB''", to: "SET maintenance_work_mem TO ''256MB''" },
  { name: "the build budget is raised past the cap", file: at("db", "roles", "settings.sql"), tests: ["test/memory-bound.test.ts"], from: "bound: build budget_mb=82", to: "bound: build budget_mb=120" },
  // #31 item 8: partition index names.
  { name: "db: the name cut shortens the partition's part first", config: DB, file: at("test", "index-names.ts"), tests: ["test/partitioned.db.test.ts"], from: "if (n1 > n2) n1 -= 1;", to: "if (n1 > 0) n1 -= 1;" },
  { name: "db: a clash numbers with an underscore", config: DB, file: at("test", "index-names.ts"), tests: ["test/partitioned.db.test.ts"], from: "const label = `${kind}${String(n)}`;", to: "const label = `${kind}_${String(n)}`;" },
  { name: "db: an expression column is named expr", config: DB, file: at("test", "partitioned.db.test.ts"), tests: ["test/partitioned.db.test.ts"], from: "then coalesce(substring(", to: "then coalesce('expr', substring(" },
  // #31 item 6: lint rule 6 and the lock bound; item 9: the fixtures; and the replays, each against the baseline.
  { name: "lint: rule 6 never fires", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: "if (locking !== null && (bound === null || bound.index > locking.index)) {", to: "if (locking !== null && bound === null && false) {" },
  { name: "lint: rule 6 takes a lock_timeout set after the statement", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: "(bound === null || bound.index > locking.index)", to: "bound === null" },
  { name: "lint: rule 6 judges files before 0305", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: "if (num >= LOCK_RULE_FROM) {", to: "if (num >= 0) {" },
  { name: "fixtures: the install takes a database not named test_", file: at("src", "fixtures.ts"), tests: ["test/fixtures.db.test.ts"], config: DB, from: '!db.startsWith("test_")', to: "false" },
  { name: "fixtures: the install runs without VF_TEST_FIXTURES=1", file: at("src", "fixtures.ts"), tests: ["test/fixtures.db.test.ts"], config: DB, from: 'if (env[FIXTURES_ENV] !== "1") return', to: 'if (env[FIXTURES_ENV] === "never") return' },
  { name: "fixtures: a lift runs in autocommit", file: at("db", "test-fixtures", "vf_test.sql"), tests: ["test/fixtures.db.test.ts"], config: DB, from: "IF statement_timestamp() = transaction_timestamp() THEN", to: "IF false THEN" },
  { name: "fixtures: a lift runs unarmed", file: at("db", "test-fixtures", "vf_test.sql"), tests: ["test/fixtures.db.test.ts"], config: DB, from: "IF coalesce(current_setting('vf_test.armed', true), '') <> 'on' THEN", to: "IF false THEN" },
  { name: "fixtures: drop_check drops a key too", file: at("db", "test-fixtures", "vf_test.sql"), tests: ["test/fixtures.db.test.ts"], config: DB, from: "AND conname = constraint_name AND contype = 'c')", to: "AND conname = constraint_name)" },
  { name: "fixtures: the file installs on a database not named test_", file: at("db", "test-fixtures", "vf_test.sql"), tests: ["test/fixtures.db.test.ts"], config: DB, from: "  IF current_database() NOT LIKE 'test\\_%' THEN\n    RAISE EXCEPTION 'vf_test fixtures", to: "  IF false THEN\n    RAISE EXCEPTION 'vf_test fixtures" },
  { name: "coverage: a catalogue holding vf_test objects is gated", file: at("scripts", "coverage-schema.ts"), tests: ["test/coverage-schema.test.ts"], from: "if (leaked.length > 0) throw", to: "if (leaked.length < 0) throw" },
  { name: "coverage: a fixture file with no function is gated", file: at("scripts", "coverage-schema.ts"), tests: ["test/coverage-schema.test.ts"], from: "if (fixtures.length === 0) throw", to: "if (fixtures.length < 0) throw" },
  { name: "db: 0064 road_events_current shows a marked row", config: DB, file: at("db", "baseline", "0293_baseline.sql"), tests: ["test/replays.db.test.ts"], from: "valid_windows, now()) AND (COALESCE(confidentiality, 'noRestriction'::text) = 'noRestriction'::text)", to: "valid_windows, now()) AND (COALESCE(confidentiality, 'noRestriction'::text) IS NOT NULL)" },
  { name: "db: 0109 sbahn is not told from rail", config: DB, file: at("db", "baseline", "0293_baseline.sql"), tests: ["test/replays.db.test.ts"], from: "WHEN (r.route_type = 109) THEN 'sbahn'", to: "WHEN (r.route_type = 10900) THEN 'sbahn'" },
  { name: "db: 0109 the SIRI ET window is nine hours", config: DB, file: at("db", "baseline", "0293_baseline.sql"), tests: ["test/replays.db.test.ts"], from: "(observed_at > (now() - '08:00:00'::interval))", to: "(observed_at > (now() - '09:00:00'::interval))" },
  { name: "db: 0201 the four-times stretch is not bounded", config: DB, file: at("db", "baseline", "0293_baseline.sql"), tests: ["test/replays.db.test.ts"], from: "new.value::int > declared_s * 4", to: "new.value::int > declared_s * 40" },
  { name: "db: 0201 a second run-now may wait", config: DB, file: at("db", "baseline", "0293_baseline.sql"), tests: ["test/replays.db.test.ts"], from: "r.action = 'run-now' and r.target = new.target and r.state = 'pending'", to: "r.action = 'run-now' and r.target = new.target and r.state = 'never'" },
  { name: "db: 0235 the IPv4 mask takes two groups", config: DB, file: at("db", "baseline", "0293_baseline.sql"), tests: ["test/replays.db.test.ts"], from: "{3}(?![0-9A-Za-z_])'::text, '<ip>'", to: "{2}(?![0-9A-Za-z_])'::text, '<ip>'" },
  { name: "db: 0263 ui.card_page_size takes 51", config: DB, file: at("db", "baseline", "0293_baseline.sql"), tests: ["test/replays.db.test.ts"], from: "WHEN (key = 'ui.card_page_size'::text) THEN (((value)::integer >= 3) AND ((value)::integer <= 50))", to: "WHEN (key = 'ui.card_page_size'::text) THEN (((value)::integer >= 3) AND ((value)::integer <= 51))" },
  { name: "db: 0285 a cap may take the other callers' floors", config: DB, file: at("db", "baseline", "0293_baseline.sql"), tests: ["test/replays.db.test.ts"], from: "sh.cap > ceil_ - (fl - sh.floor)", to: "sh.cap > ceil_" },
  { name: "db: 0285 owed_by without owed_at", config: DB, file: at("db", "baseline", "0293_baseline.sql"), tests: ["test/replays.db.test.ts"], from: "CONSTRAINT budget_state_owed_pair CHECK (((owed_by IS NULL) = (owed_at IS NULL)))", to: "CONSTRAINT budget_state_owed_pair CHECK (((owed_by IS NULL) OR (owed_at IS NOT NULL)))" },
  // #32: the schema behaviour mutants (functions, triggers, views); each names database tests only.
  ...SCHEMA_BEHAVIOUR_MUTANTS.map((m) => ({ ...m, config: DB })),
];

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] ?? "" : null;

const originals = new Map<string, string>();
const restore = (): void => {
  for (const [f, s] of originals) writeFileSync(f, s);
};
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

let survived = 0;
let killed = 0;
// A mutant is killed by a FAILING run, so the same tests must pass unmutated
// first: a database run without TEST_DATABASE_URL fails every time and would
// otherwise read as every mutant killed.
const controls = new Set(MUTANTS.filter((m) => (only === null || m.name.includes(only)) && m.config !== undefined).map((m) => JSON.stringify([m.config, m.tests ?? TESTS])));
for (const c of controls) {
  const [config, tests] = JSON.parse(c) as [string, string[]];
  const r = spawnSync("npx", ["vitest", "run", "--config", config, ...tests], { cwd: ROOT, encoding: "utf8", env: { ...process.env, VF_REQUIRE_DB: "1" } });
  if (r.status !== 0) {
    console.log(`✗ refused: ${tests.join(" ")} fails UNMUTATED under ${config} (TEST_DATABASE_URL and psql set?) — no mutant of it can be judged`);
    process.exit(2);
  }
  console.log(`  control: ${tests.join(" ")} passes unmutated`);
}
try {
  for (const m of MUTANTS) {
    if (only !== null && !m.name.includes(only)) continue;
    const file = m.file ?? FILE;
    const original = originals.get(file) ?? readFileSync(file, "utf8");
    originals.set(file, original);
    // A function, so a `$$` in the replacement is two dollars and not a replacement pattern.
    const mutated = original.replace(m.from, () => m.to);
    if (mutated === original) {
      console.log(`  ? ${m.name}: the pattern no longer matches ${file} — fix the mutant`);
      survived += 1;
      continue;
    }
    writeFileSync(file, mutated);
    // A database test runs under its own config, and must not pass by being skipped.
    const env = m.config === undefined ? process.env : { ...process.env, VF_REQUIRE_DB: "1" };
    const r = spawnSync("npx", ["vitest", "run", ...(m.config === undefined ? [] : ["--config", m.config]), ...(m.tests ?? TESTS)], { cwd: ROOT, encoding: "utf8", env });
    restore();
    if (r.status === 0) {
      console.log(`  ✗ SURVIVED: ${m.name}`);
      survived += 1;
    } else {
      console.log(`  ✓ killed: ${m.name}`);
      killed += 1;
    }
  }
} finally {
  restore();
}
console.log(`${survived === 0 ? "✓" : "✗"} mutants: ${String(killed)} killed, ${String(survived)} survived`);
process.exit(survived === 0 ? 0 : 1);
