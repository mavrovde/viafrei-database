/**
 * Mutation check of the head/readiness logic and of the schema coverage gate:
 * each mutant is one small, plausible bug in src/migrations/plan.ts or
 * scripts/coverage-schema.ts. The tests named for it must fail on every one of
 * them, or they do not guard what they claim to. The file is restored after
 * each mutant, also on an interrupted run.
 *
 *   npm run mutate                       every mutant
 *   npm run mutate -- --only <text>      the mutants whose name contains <text>
 *
 * A mutant with `config: DB` runs its tests with vitest.db.config.ts, so it
 * needs TEST_DATABASE_URL (and psql) like `npm run test:db`; each such run
 * migrates its own database, about a minute.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  { name: "db: a plant keeps the triggers enabled ALWAYS", config: DB, file: at("test", "checks.ts"), tests: ["test/checks.db.test.ts"], from: "    await c.query(`alter table ${relation} disable trigger user`);\n", to: "" },
  { name: "db: the lifted control keeps the check", config: DB, file: at("test", "checks.ts"), tests: ["test/checks.db.test.ts"], from: "[relation, check, lift]", to: "[relation, check, false]" },
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
  const r = spawnSync("npx", ["vitest", "run", "--config", config, ...tests], { cwd: ROOT, encoding: "utf8" });
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
    const r = spawnSync("npx", ["vitest", "run", ...(m.config === undefined ? [] : ["--config", m.config]), ...(m.tests ?? TESTS)], { cwd: ROOT, encoding: "utf8" });
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
