/**
 * `test-fixtures install` (#31 item 9): the test-only fixture functions of
 * db/test-fixtures/vf_test.sql, for a TEST database and nothing else. Never
 * part of `migrate` or `serve`.
 *
 * Refused (exit 2) before any connection unless VF_TEST_FIXTURES=1 is set AND
 * the database DATABASE_URL names starts with `test_`; the file refuses once
 * more on the server's own current_database(), so a URL that resolves
 * elsewhere (a service file, a proxy) cannot slip past.
 *
 * `test-fixtures seed FILE` (#29, for viafrei-api's integration tests) is
 * gated the same way: it installs db/test-fixtures/contract_seed.sql (an
 * INSTEAD OF INSERT trigger on every contract view, writing the platform
 * tables that view reads, and reading the row back) and runs FILE's
 * `insert into contract.<relation> (...) values ...` statements, all in one
 * transaction. A database is seeded once; a second seed is refused.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { APP_ROOT } from "./config.js";
import { psqlRunner, type PsqlRunner } from "./psql.js";

export const FIXTURES_FILE = join(APP_ROOT, "db", "test-fixtures", "vf_test.sql");
export const SEED_FILE = join(APP_ROOT, "db", "test-fixtures", "contract_seed.sql");
export const FIXTURES_ENV = "VF_TEST_FIXTURES";

export type FixturesResult = { readonly exitCode: number; readonly lines: readonly string[] };

/** The database a postgresql:// URL names, or null when it names none. */
export function databaseOf(url: string): string | null {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return name === "" ? null : name;
  } catch {
    return null;
  }
}

/** Why the install (or the seed) must not run, or null when it may. */
export function fixturesRefusal(env: NodeJS.ProcessEnv, verb: "install" | "seed" = "install"): string | null {
  const what = `test-fixtures ${verb}`;
  if (env[FIXTURES_ENV] !== "1") return `${what} needs ${FIXTURES_ENV}=1: the fixtures lift guards, and are installed only on purpose`;
  const url = env["DATABASE_URL"];
  if (url === undefined || url === "") return `${what} needs DATABASE_URL`;
  const db = databaseOf(url);
  if (db === null || !db.startsWith("test_")) return `${what} refuses the database '${db ?? "(none)"}': only a database whose name starts with test_ takes the fixtures`;
  return null;
}

/** psql's first ERROR line (else its first non-empty line), cut at 300 characters. */
function firstLine(stderr: string): string {
  const lines = stderr.split("\n").filter((l) => l.trim() !== "");
  return (lines.find((l) => /\b(ERROR|FATAL):/.test(l)) ?? lines[0] ?? "(no message)").slice(0, 300);
}

export async function installFixtures(env: NodeJS.ProcessEnv, run?: PsqlRunner, file: string = FIXTURES_FILE): Promise<FixturesResult> {
  const why = fixturesRefusal(env);
  if (why !== null) return { exitCode: 2, lines: [`✗ ${why}`] };
  let sql: string;
  try {
    sql = readFileSync(file, "utf8");
  } catch {
    return { exitCode: 1, lines: [`✗ test fixtures: ${file} could not be read`] };
  }
  const psql = run ?? psqlRunner({ databaseUrl: env["DATABASE_URL"] ?? "" });
  const r = await psql(sql, ["-1", "-f", "-"]);
  if (r.code !== 0) {
    return { exitCode: 1, lines: [`✗ test fixtures could not be installed (psql exit ${String(r.code)}): ${firstLine(r.stderr)}`] };
  }
  // the coverage gate's pattern: vf_test and vf_test_clock alike
  const n = (sql.match(/^CREATE OR REPLACE FUNCTION vf_test[a-z_]*\./gm) ?? []).length;
  return { exitCode: 0, lines: [`✓ test fixtures: ${String(n)} vf_test function(s) installed (test database ${databaseOf(env["DATABASE_URL"] ?? "") ?? ""})`] };
}

/**
 * Seeds a test database through the read contract: the seed triggers, then
 * the one-seed-per-database guard, then FILE, in one transaction, so a row the
 * contract cannot read back as given (or a second seed) leaves nothing behind.
 */
export async function seedFixtures(env: NodeJS.ProcessEnv, file: string, run?: PsqlRunner, seedFile: string = SEED_FILE): Promise<FixturesResult> {
  const why = fixturesRefusal(env, "seed");
  if (why !== null) return { exitCode: 2, lines: [`✗ ${why}`] };
  let triggers: string;
  let rows: string;
  try {
    triggers = readFileSync(seedFile, "utf8");
  } catch {
    return { exitCode: 1, lines: [`✗ test fixtures: ${seedFile} could not be read`] };
  }
  try {
    rows = readFileSync(file, "utf8");
  } catch {
    return { exitCode: 1, lines: [`✗ test-fixtures seed: ${file} could not be read`] };
  }
  const name = basename(file).replaceAll("'", "''");
  // fixturesRefusal has read DATABASE_URL as set and named test_*.
  const url = String(env["DATABASE_URL"]);
  const psql = run ?? psqlRunner({ databaseUrl: url });
  const r = await psql(`${triggers}\nselect vf_test.contract_seed_begin('${name}');\n${rows}\n`, ["-1", "-f", "-"]);
  if (r.code !== 0) return { exitCode: 1, lines: [`✗ test fixtures could not be seeded (psql exit ${String(r.code)}): ${firstLine(r.stderr)}`] };
  const n = (rows.match(/^\s*insert\s+into\s+contract\./gim) ?? []).length;
  return { exitCode: 0, lines: [`✓ test fixtures: ${String(n)} contract insert(s) seeded from ${basename(file)} (test database ${String(databaseOf(url))})`] };
}
