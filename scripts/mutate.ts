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
 * mutant planted (scripts/mutate-run.ts). The set itself is scripts/mutants.ts.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { FILE, MUTANTS, TESTS } from "./mutants.js";
import { runMutants } from "./mutate-run.js";

const ROOT = join(import.meta.dirname, "..");

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
