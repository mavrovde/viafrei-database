/**
 * `test-fixtures install` (#31 item 9): the test-only fixture functions of
 * db/test-fixtures/vf_test.sql, for a TEST database and nothing else. Never
 * part of `migrate` or `serve`.
 *
 * Refused (exit 2) before any connection unless VF_TEST_FIXTURES=1 is set AND
 * the database DATABASE_URL names starts with `test_`; the file refuses once
 * more on the server's own current_database(), so a URL that resolves
 * elsewhere (a service file, a proxy) cannot slip past.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT } from "./config.js";
import { psqlRunner, type PsqlRunner } from "./psql.js";

export const FIXTURES_FILE = join(APP_ROOT, "db", "test-fixtures", "vf_test.sql");
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

/** Why the install must not run, or null when it may. */
export function fixturesRefusal(env: NodeJS.ProcessEnv): string | null {
  if (env[FIXTURES_ENV] !== "1") return `test-fixtures install needs ${FIXTURES_ENV}=1: the fixtures lift guards, and are installed only on purpose`;
  const url = env["DATABASE_URL"];
  if (url === undefined || url === "") return "test-fixtures install needs DATABASE_URL";
  const db = databaseOf(url);
  if (db === null || !db.startsWith("test_")) return `test-fixtures install refuses the database '${db ?? "(none)"}': only a database whose name starts with test_ takes the fixtures`;
  return null;
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
    const first = r.stderr.split("\n").find((l) => l.trim() !== "") ?? "(no message)";
    return { exitCode: 1, lines: [`✗ test fixtures could not be installed (psql exit ${String(r.code)}): ${first.slice(0, 300)}`] };
  }
  // the coverage gate's pattern: vf_test and vf_test_clock alike
  const n = (sql.match(/^CREATE OR REPLACE FUNCTION vf_test[a-z_]*\./gm) ?? []).length;
  return { exitCode: 0, lines: [`✓ test fixtures: ${String(n)} vf_test function(s) installed (test database ${databaseOf(env["DATABASE_URL"] ?? "") ?? ""})`] };
}
