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
 * skipped; each such run migrates its own database. Every distinct run, unit
 * and database alike, must pass unmutated first, or the script exits 2 with no
 * mutant planted (scripts/mutate-run.ts).
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { SCHEMA_BEHAVIOUR_MUTANTS } from "./mutants-schema-behaviour.js";
import { type Mutant, runMutants } from "./mutate-run.js";

const ROOT = join(import.meta.dirname, "..");
const FILE = join(ROOT, "src", "migrations", "plan.ts");
const TESTS = ["test/plan.test.ts", "test/service.test.ts", "test/http.test.ts", "test/actions.test.ts"];

const DB = "vitest.db.config.ts";
const at = (...p: string[]): string => join(ROOT, ...p);
const GATE = join(ROOT, "scripts", "coverage-schema.ts");
const GATE_TESTS = ["test/coverage-schema.test.ts"];
const API_TESTS = ["test/api-schemas.db.test.ts"];
const MAP_TESTS = ["test/contract-mapping.db.test.ts"];
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
  { name: "lint: rule 6 judges files before 0294", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: "if (num >= LOCK_RULE_FROM) {", to: "if (num >= 0) {" },
  { name: "lint: rule 6 misses a create trigger", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: String.raw`(?:constraint\s+)?trigger\s+`, to: String.raw`(?:constraint\s+)?triggerX\s+` },
  { name: "lint: rule 6 misses a drop trigger", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: String.raw`\bdrop\s+trigger\s+`, to: String.raw`\bdrop\s+triggerX\s+` },
  { name: "lint: rule 6 misses a plain drop index", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: String.raw`\bdrop\s+index\s+(?!concurrently`, to: String.raw`\bdrop\s+indexX\s+(?!concurrently` },
  { name: "lint: rule 6 misses a plain reindex", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: String.raw`\breindex\s+`, to: String.raw`\breindexX\s+` },
  { name: "lint: rule 6 misses a lock table", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: String.raw`lock\s+(?:table\s+)?(?:only`, to: String.raw`lockX\s+(?:table\s+)?(?:only` },
  { name: "lint: rule 6 misses a truncate", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: String.raw`truncate\s+(?:table`, to: String.raw`truncateX\s+(?:table` },
  { name: "lint: rule 6 misses a create or replace view", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: String.raw`replace\s+view\s+`, to: String.raw`replace\s+viewX\s+` },
  { name: "lint: rule 6 misses a dynamic alter", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: String.raw`format\s*\(\s*'\s*alter`, to: String.raw`format\s*\(\s*'\s*alterX` },
  { name: "lint: rule 6 reads a function body as applied", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: String.raw`body.replace(/[^\n]/g, " ")`, to: "body" },
  { name: "lint: rule 6 takes lock and truncate anywhere in the text", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: String.raw`(?<=^|;)[^\S\n]*lock`, to: "lock" },
  { name: "lint: rule 6 reads into string literals", file: at("src", "lint", "check-migrations.ts"), tests: ["test/lint.test.ts"], from: "(l) => `'${\" \".repeat(l.length - 2)}'`", to: "(l) => l" },
  { name: "fixtures: the install takes a database not named test_", file: at("src", "fixtures.ts"), tests: ["test/fixtures.db.test.ts"], config: DB, from: '!db.startsWith("test_")', to: "false" },
  { name: "fixtures: the install runs without VF_TEST_FIXTURES=1", file: at("src", "fixtures.ts"), tests: ["test/fixtures.db.test.ts"], config: DB, from: 'if (env[FIXTURES_ENV] !== "1") return', to: 'if (env[FIXTURES_ENV] === "never") return' },
  { name: "fixtures: a lift runs in autocommit", file: at("db", "test-fixtures", "vf_test.sql"), tests: ["test/fixtures.db.test.ts"], config: DB, from: "IF statement_timestamp() = transaction_timestamp() THEN", to: "IF false THEN" },
  { name: "fixtures: a lift runs unarmed", file: at("db", "test-fixtures", "vf_test.sql"), tests: ["test/fixtures.db.test.ts"], config: DB, from: "IF coalesce(current_setting('vf_test.armed', true), '') <> 'on' THEN", to: "IF false THEN" },
  { name: "fixtures: drop_check drops a key too", file: at("db", "test-fixtures", "vf_test.sql"), tests: ["test/fixtures.db.test.ts"], config: DB, from: "AND conname = constraint_name AND contype = 'c')", to: "AND conname = constraint_name)" },
  { name: "fixtures: the file installs on a database not named test_", file: at("db", "test-fixtures", "vf_test.sql"), tests: ["test/fixtures.db.test.ts"], config: DB, from: "  IF current_database() NOT LIKE 'test\\_%' THEN\n    RAISE EXCEPTION 'vf_test fixtures", to: "  IF false THEN\n    RAISE EXCEPTION 'vf_test fixtures" },
  { name: "seed: the verb takes a database not named test_", file: at("src", "fixtures.ts"), tests: ["test/contract-seed.db.test.ts"], config: DB, from: 'const why = fixturesRefusal(env, "seed");', to: "const why = null as string | null;" },
  { name: "seed: the file seeds a database not named test_", file: at("db", "test-fixtures", "contract_seed.sql"), tests: ["test/contract-seed.db.test.ts"], config: DB, from: "  IF current_database() NOT LIKE 'test\\_%' THEN\n    RAISE EXCEPTION 'vf_test contract seed is", to: "  IF false THEN\n    RAISE EXCEPTION 'vf_test contract seed is" },
  { name: "seed: a database is seeded twice", file: at("db", "test-fixtures", "contract_seed.sql"), tests: ["test/contract-seed.db.test.ts"], config: DB, from: "IF EXISTS (SELECT FROM vf_test.contract_seed_runs) THEN", to: "IF false THEN" },
  { name: "seed: a row the view reads otherwise passes", file: at("db", "test-fixtures", "contract_seed.sql"), tests: ["test/contract-seed.db.test.ts"], config: DB, from: "  IF ok THEN RETURN; END IF;", to: "  RETURN;" },
  { name: "seed: a stop point loses its platform", file: at("db", "test-fixtures", "contract_seed.sql"), tests: ["test/contract-seed.db.test.ts"], config: DB, from: "0, parent, NEW.platform_label);", to: "0, parent, null);" },
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
  // #29: viafrei-api's contract (0307) and access store (0308), and their roles' password step.
  { name: "db: 0307 states contract 0.2", config: DB, file: at("db", "migrations", "0307_contract_read_model.sql"), tests: API_TESTS, from: "select '0.3'::text", to: "select '0.2'::text" },
  { name: "db: 0307 publishes a row of contract.rule_topic", config: DB, file: at("db", "migrations", "0307_contract_read_model.sql"), tests: API_TESTS, from: "as reviewed_on\n where false;", to: "as reviewed_on\n where true;" },
  { name: "db: 0312 serves Toll Collect SID without its per-request terms gate", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "'gated', 'sid-terms-1', null", to: "'gated', null, null" },
  { name: "db: 0312 keeps the Autobahn API for own keys", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "(20, '(truckpark_sid|toll_collect_sid)'", to: "(15, '^autobahn', false, 'own', 'consumer_only', null, null, null),\n    (20, '(truckpark_sid|toll_collect_sid)'" },
  { name: "db: 0312 moves an Autobahn sweep back on a late tick", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "   where s.observed_at < excluded.observed_at;", to: "   where true;" },
  { name: "db: 0312 lists lorry parks and chargers as traffic events", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "     and s.kind in ('warning', 'roadworks', 'closure', 'closure_entry_exit')\n", to: "" },
  { name: "db: 0312 leaves a junction's Land empty", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "       public.contract_junction_land(t.geom)                 as state_code,", to: "       null::text                                            as state_code," },
  { name: "db: 0312 offers no changed share-alike data", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "'https://viafrei.de/impressum'", to: "null" },
  { name: "db: 0312 gives Tankerkoenig fuel to every key", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "(30, 'tankerkoenig', false, 'own'", to: "(30, 'tankerkoenig', false, 'public'" },
  { name: "db: 0312 maps the CC BY-NC-SA fuel history", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "enerando_stat)', true,", to: "enerando_stat)', false," },
  { name: "db: 0312 lets a confidential road event show", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "case when coalesce(b.confidentiality, 'noRestriction') <> 'noRestriction' then 'withhold'", to: "case when false then 'withhold'" },
  { name: "db: 0312 lets a private charging site show", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: " or s.access_private then 'withhold'", to: " then 'withhold'" },
  { name: "db: 0312 drops the Autobahn payload a tick does not store", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "and r.raw_hash = e.raw_hash", to: "and r.raw_hash <> e.raw_hash" },
  { name: "db: 0312 keeps Autobahn events that left the newest sweep", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "n.at = e.observed_at", to: "n.at >= e.observed_at" },
  { name: "db: 0312 publishes a road event we retracted", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "    from public.road_events e\n   where e.deleted_at is null\n", to: "    from public.road_events e\n" },
  { name: "db: 0312 counts GTFS times from midnight", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "- interval '12 hours' + st.arrival", to: "+ st.arrival" },
  { name: "db: 0312 calls a source stale after twice its cadence", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "3 * coalesce(s.cadence_s", to: "2 * coalesce(s.cadence_s" },
  { name: "db: 0312 calls a source with no cadence stale after a day", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "3 * coalesce(s.cadence_s, f.cadence_s)             as stale_after_s", to: "3 * coalesce(s.cadence_s, f.cadence_s, 28800)      as stale_after_s" },
  { name: "db: 0312 reads a feed's register row by its key, not its licence id", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "left join public.source_register g on g.source_id = c.licence_id", to: "left join public.source_register g on g.source_id = c.feed_key" },
  { name: "db: 0312 keeps every licence class of a restricted source", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "else array(select u from unnest(coalesce(g.use_classes, '{}')) u where u = 'consumer') end", to: "else coalesce(g.use_classes, '{}') end" },
  { name: "db: 0312 files GeoNames under roads", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "(50, '^(geonames|", to: "(50, '^(xgeonames|" },
  { name: "db: 0312 names the source URL as a rule's legal basis", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "f.source_name                        as legal_basis", to: "f.source_url                         as legal_basis" },
  { name: "db: 0312 lists a register row a feed owns as a second source", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "where c.feed_key = g.source_id or c.licence_id = g.source_id)", to: "where c.feed_key = g.source_id)" },
  { name: "db: 0312 folds an umlaut to its bare letter", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "replace(replace(replace(replace(replace(lower(t), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue')", to: "replace(replace(replace(replace(replace(lower(t), 'ä', 'a'), 'ö', 'o'), 'ü', 'u')" },
  { name: "db: 0312 keeps the spaces of a folded name", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "'[^[:alnum:]]', '', 'g');", to: "'[^[:alnum:][:space:]]', '', 'g');" },
  { name: "db: 0312 keeps the accents a German name does not carry", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "                     'aaaaaaaacccceeeeeeeeiiiiiinnnoooooosssuuuuuuyyzzzlrgdt'),", to: "                     'àáâãåāăąçćčĉèéêëēėęěìíîïīįñńňòóôõøōśšşùúûūůűýÿźżžłřğďť')," },
  { name: "db: 0312 takes a timetable-only row before the DB station", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "order by x.source_id = 'db_stada' desc, x.station_no limit 1", to: "order by x.station_no desc limit 1" },
  { name: "db: 0312 names no municipality for a stop no DB station lists", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "                  order by g.geom::geometry <-> s.geom::geometry limit 1)) as municipality_name", to: "                  order by g.geom::geometry <-> s.geom::geometry limit 0)) as municipality_name" },
  { name: "db: 0312 drops a stop's own DHID as its lookup code", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "coalesce(d.ifopt, case when s.id ~ '^[a-z]{2}:[0-9]{5}:[0-9]+$' then s.id end) as ifopt", to: "d.ifopt as ifopt" },
  { name: "db: 0312 finds no KVB Haltestelle without a parent stop", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "                  or s.id like substring(ref from", to: "                  or false and s.id like substring(ref from" },
  { name: "db: 0312 leaves FaSta without its stop place", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "       (select public.contract_stop_place_of(d.ifopt) from public.db_stations d where d.station_no = f.station_no),", to: "       null," },
  { name: "db: 0312 reads an OpenStation DHID as written", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "'^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)')\n", to: "'^([a-z]{2}:[0-9]{5}:[0-9]+)')\n" },
  { name: "db: 0312 road line starts a chain at a point a link reaches", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "      continue when used[i] or (pass = 1 and reached[i]);", to: "      continue when used[i];" },
  { name: "db: 0312 road line drops the cycles", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "  for pass in 1 .. 2 loop", to: "  for pass in 1 .. 1 loop" },
  { name: "db: 0312 road line draws a lone point", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "    if cl[c] >= 2 then", to: "    if cl[c] >= 1 then" },
  { name: "db: 0312 road line keeps the chains in code order", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "order by (lon[mem[cs[x.c]]] - ax) * dx + (lat[mem[cs[x.c]]] - ay) * dy, lcds[mem[cs[x.c]]])", to: "order by lcds[mem[cs[x.c]]])" },
  { name: "db: 0312 road line lays a spur among the road's pieces", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "  ord := array(select u.o from unnest(ord) with ordinality u(o, x) where not spur[u.o] order by u.x)\n      || array(select u.o from unnest(ord) with ordinality u(o, x) where spur[u.o] order by u.x);", to: "  ord := ord;" },
  { name: "db: 0312 road line finds no spur", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "<= 1000 then", to: "<= 100 then" },
  { name: "db: 0312 road length counts a break", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "      if i > cs[c] then", to: "      if i > 1 then" },
  { name: "db: 0312 road states put a spur last", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "    ro := ro[1:best] || walk || ro[best + 1:];", to: "    ro := ro || walk;" },
  { name: "db: 0312 road states read an unnamed point", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "    continue when not named[i];", to: "    continue when false;" },
  { name: "db: 0312 road states repeat a Land", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "    if land is not null and (states is null or not land = any(states)) then", to: "    if land is not null then" },
  { name: "db: 0312 junction Land reaches past 20 km", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "     and st_dwithin(g.geom, p, 20000)", to: "     and st_dwithin(g.geom, p, 2000000)" },
  { name: "db: 0312 junction Land reads an unkeyed Gemeinde", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "     and g.admin_code ~ '^[0-9]{8}$' and g.geom is not null", to: "     and g.geom is not null" },
  { name: "db: 0312 junction Land reads a closed Gemeinde", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "   where g.closed_at is null and g.source_id = 'bkg_gvisys' and g.kind = 'city'", to: "   where g.source_id = 'bkg_gvisys' and g.kind = 'city'" },
  { name: "db: 0312 road line bridges a gap", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "      lines := lines || st_makeline(chain);", to: "      lines := array[st_makeline(coalesce(lines[1], st_makeline(chain)), st_makeline(chain))];" },
  { name: "db: 0312 road credits no LCL", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "       case when l.line is null then array['autobahn'] else array['autobahn', 'bast_lcl'] end as source_refs", to: "       array['autobahn'] as source_refs" },
  { name: "db: 0312 severity ignores an item the provider marks blocked", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "           when a.kind = 'closure' or a.p->>'isBlocked' = 'true' then 'road_closed'", to: "           when a.kind = 'closure' then 'road_closed'" },
  { name: "db: 0312 severity calls a ten-minute jam short", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "             then case when a.delay_s >= 600 then 'major' else 'minor' end", to: "             then case when a.delay_s > 600 then 'major' else 'minor' end" },
  { name: "db: 0312 severity grades roadworks as a short jam", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "           when a.kind = 'roadworks' then 'lane_closed'", to: "           when a.kind = 'roadworks' then 'minor'" },
  { name: "db: 0312 traffic_event calls any traffic type a jam", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "                and a.abnormal_traffic_type in ('QUEUING_TRAFFIC', 'STATIONARY_TRAFFIC', 'SLOW_TRAFFIC', 'HEAVY_TRAFFIC') then 'jam'", to: "                and a.abnormal_traffic_type is not null then 'jam'" },
  { name: "db: 0312 traffic_event calls a lane deviation a closure", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "           when e.event_type ~* '(closure|sperrung)' then 'closure'", to: "           when e.event_type ~* '(closure|sperrung|carriagewayorlanemanagement)' then 'closure'" },
  { name: "db: 0312 severity leaves a German closure ungraded", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "           when e.event_type ~* '(closure|sperrung)' then 'road_closed'", to: "           when e.event_type ~* '(closure)' then 'road_closed'" },
  { name: "db: 0312 severity grades a hazard other", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "           when e.event_type ~* '(weather|environment|obstruction|hazard|animal|vehicle|equipment)' then 'info'", to: "           when e.event_type ~* '(weather|environment)' then 'info'" },
  { name: "db: 0312 the accessibility sources answer for transit", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "    (55, '(^db_fasta$|aufzug|lifts|^openstation_|^bfrk_)', 'accessibility'),", to: "    (55, '^$', 'accessibility')," },
  { name: "db: 0312 departure takes Trip Updates before SIRI ET", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "    select case when sc.call_at is not null and (sc.cancelled or abs(coalesce(sc.delay_s, 0)) <= 21600)", to: "    select case when false and sc.call_at is not null and (sc.cancelled or abs(coalesce(sc.delay_s, 0)) <= 21600)" },
  { name: "db: 0312 departure reads the earliest stop's update, not the latest earlier one", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "       order by x.stop_sequence desc limit 1", to: "       order by x.stop_sequence asc limit 1" },
  { name: "db: 0312 departure keeps a skipped stop running", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "             when sr.rel = 'SKIPPED' then true\n", to: "             when sr.rel = 'SKIPPED' then null\n" },
  { name: "db: 0312 departure keeps a cancelled trip running", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "    trip_row as (select x.rel, x.observed_at from run x where x.stop_sequence is null order by x.observed_at desc limit 1),", to: "    trip_row as (select x.rel, x.observed_at from run x where false order by x.observed_at desc limit 1)," },
  { name: "db: 0312 departure reads past NO_DATA", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "             when sr.rel in ('NO_DATA', 'SKIPPED') then null", to: "             when sr.rel in ('SKIPPED') then null" },
  { name: "db: 0312 departure reads Trip Updates while the feed is down", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "                      where c.feed_key = 'tripupdates' and c.checked_at is not null", to: "                      where true or c.feed_key = 'tripupdates' and c.checked_at is not null" },
  { name: "db: 0312 departure takes a bridged call that names another end", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "       and (not refs.bridged or c.destination = btrim(t.headsign))", to: "       and true" },
  { name: "db: 0312 departure takes another line's call", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "       and upper(regexp_replace(c.line, '\\s+', '', 'g')) = ", to: "       and true or upper(regexp_replace(c.line, '\\s+', '', 'g')) = " },
  { name: "db: 0312 departure never reports a platform change", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "       coalesce(sc.platform <> btrim(s.platform_code), false)                         as platform_changed,", to: "       false                                                                          as platform_changed," },
  { name: "db: 0312 departure shows a delay of days", config: DB, file: at("db", "migrations", "0312_contract_mapping.sql"), tests: MAP_TESTS, from: "                when tu.carried and (tu.cancelled or (tu.delay_s is not null and abs(tu.delay_s) <= 21600)) then 'tu'", to: "                when tu.carried and (tu.cancelled or (tu.delay_s is not null)) then 'tu'" },
  { name: "seed: a live departure is seeded with its feed down", file: at("db", "test-fixtures", "contract_seed.sql"), tests: ["test/contract-seed.db.test.ts"], config: DB, from: "VALUES ('feed', feed, now(), now())", to: "VALUES ('feed', feed, now() - interval '1 day', now())" },
  { name: "db: 0309 narrows GeoNames to consumer answers", config: DB, file: at("db", "migrations", "0309_source_register.sql"), tests: MAP_TESTS, from: "'CC BY 4.0', false, false, 'bearbeitet', array['consumer', 'non_commercial', 'commercial'], false, false, '2026-10-08'", to: "'CC BY 4.0', false, false, 'bearbeitet', array['consumer'], false, false, '2026-10-08'" },
  { name: "db: 0309 files the MTS-K purpose note as a condition", config: DB, file: at("db", "migrations", "0309_source_register.sql"), tests: MAP_TESTS, from: "('tankerkoenig', 'purpose', 'de',", to: "('tankerkoenig', 'condition', 'de'," },
  { name: "db: 0311 shows BW messages after they stop being current", config: DB, file: at("db", "migrations", "0311_message_coverage.sql"), tests: MAP_TESTS, from: "('08', 'traffic_bw', 'own', true, null)", to: "('08', 'traffic_bw', 'own', false, null)" },
  { name: "db: 0307 drifts a contract column's type", config: DB, file: at("db", "migrations", "0307_contract_read_model.sql"), tests: API_TESTS, from: "null::numeric(6,1)                     as length_km,", to: "null::numeric                          as length_km," },
  { name: "db: 0307 grants api_reader no contract view", config: DB, file: at("db", "migrations", "0307_contract_read_model.sql"), tests: API_TESTS, from: "grant select on all tables in schema contract to api_reader;\n", to: "" },
  { name: "db: 0307 lets api_reader write the contract", config: DB, file: at("db", "migrations", "0307_contract_read_model.sql"), tests: API_TESTS, from: "grant select on all tables in schema contract to api_reader;", to: "grant select, insert on all tables in schema contract to api_reader;" },
  { name: "db: 0307 takes an api_reader that is a member of another role", config: DB, file: at("db", "migrations", "0307_contract_read_model.sql"), tests: API_TESTS, from: " AND NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE member = 'api_reader'::regrole))", to: ")" },
  { name: "db: 0308 lets api_access delete audit rows", config: DB, file: at("db", "migrations", "0308_access_store.sql"), tests: API_TESTS, from: "grant select, insert on access.terms_acceptance, access.audit to api_access;", to: "grant select, insert, delete on access.terms_acceptance, access.audit to api_access;" },
  { name: "db: 0308 prunes audit rows younger than 30 days", config: DB, file: at("db", "migrations", "0308_access_store.sql"), tests: API_TESTS, from: "if before > now() - interval '30 days' then", to: "if before > now() - interval '1 days' then" },
  { name: "db: 0308 prunes usage younger than 30 days", config: DB, file: at("db", "migrations", "0308_access_store.sql"), tests: API_TESTS, from: "if keep_days < 30 then", to: "if keep_days < 1 then" },
  { name: "db: 0308 leaves prune_audit open to PUBLIC", config: DB, file: at("db", "migrations", "0308_access_store.sql"), tests: API_TESTS, from: "revoke all on function access.prune_audit(timestamptz) from public;\n", to: "" },
  { name: "db: 0308 refuses the console sign-in audit action", config: DB, file: at("db", "migrations", "0308_access_store.sql"), tests: API_TESTS, from: ", 'console_sign_in'))", to: "))" },
  { name: "db: 0308 makes a new key own by default", config: DB, file: at("db", "migrations", "0308_access_store.sql"), tests: API_TESTS, from: "audience       text not null default 'public'", to: "audience       text not null default 'own'" },
  { name: "db: 0308 accepts any key audience", config: DB, file: at("db", "migrations", "0308_access_store.sql"), tests: API_TESTS, from: "check (audience in ('public', 'own'))", to: "check (audience <> '')" },
  { name: "db: 0308 forgets the store's version 3", config: DB, file: at("db", "migrations", "0308_access_store.sql"), tests: API_TESTS, from: "values (1), (2), (3);", to: "values (1), (2);" },
  { name: "roles: api_reader's password is fatal", file: at("src", "roles.ts"), tests: ["test/roles.test.ts"], from: '{ role: "api_reader", sqlFile: "api-reader-role-password.sql", fatal: false }', to: '{ role: "api_reader", sqlFile: "api-reader-role-password.sql", fatal: true }' },
];

// vitest is run by this node from the repository's own install, never found on
// PATH; the runs get a fixed PATH: this node's directory, psql's (VF_DB_PSQL, or
// the psql the caller's PATH names, resolved once to an absolute path, which
// the database tests then call by name) and the system directories.
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");
const executable = (f: string): boolean => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
const psqlBin = ((): string | null => {
  const given = process.env["VF_DB_PSQL"];
  if (given !== undefined && isAbsolute(given)) return given;
  for (const d of (process.env["PATH"] ?? "").split(delimiter)) if (isAbsolute(d) && executable(join(d, given ?? "psql"))) return join(d, given ?? "psql");
  return null;
})();
const FIXED_PATH = [...new Set([dirname(process.execPath), ...(psqlBin === null ? [] : [dirname(psqlBin)]), "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(delimiter);
const vitest = (args: readonly string[], env: NodeJS.ProcessEnv) =>
  spawnSync(process.execPath, [VITEST, "run", ...args], { cwd: ROOT, encoding: "utf8", env: { ...env, PATH: FIXED_PATH, ...(psqlBin === null ? {} : { VF_DB_PSQL: psqlBin }) } });

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] ?? "" : null;

const originals = new Map<string, string>();
process.on("SIGINT", () => {
  for (const [f, text] of originals) writeFileSync(f, text);
  process.exit(130);
});

// A database mutant runs under its own config and VF_REQUIRE_DB=1, so it cannot
// pass by being skipped; a unit mutant runs the unit config. Each distinct run
// is first made UNMUTATED (scripts/mutate-run.ts): a red control is exit 2.
const selected = MUTANTS.filter((m) => only === null || m.name.includes(only));
const result = runMutants(selected, { file: FILE, tests: TESTS }, {
  run: (config, tests) => vitest([...(config === undefined ? [] : ["--config", config]), ...tests], config === undefined ? process.env : { ...process.env, VF_REQUIRE_DB: "1" }).status,
  read: (f) => readFileSync(f, "utf8"),
  write: (f, text) => writeFileSync(f, text),
  log: (line) => console.log(line),
}, originals);
process.exit(result.code);
