/**
 * Every row-level security policy of ours, as one table (test/policies/expected.tsv):
 *
 *   relation \t policy \t command \t roles \t permissive \t using \t with check
 *
 * using / with check are pg_policies' qual and with_check with newlines and
 * runs of spaces folded to one space, `-` when absent.
 *
 *   npx tsx test/policies.ts <database url>    prints the table of a migrated database
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ROOT = join(import.meta.dirname, "..");

export type PolicyRow = { readonly relation: string; readonly name: string; readonly cmd: string; readonly roles: string; readonly permissive: string; readonly using: string; readonly check: string };

export const POLICIES_SQL = `
select schemaname || '.' || tablename as relation, policyname as name, cmd, array_to_string(roles, ',') as roles, permissive,
       coalesce(regexp_replace(qual, '\\s+', ' ', 'g'), '-') as using, coalesce(regexp_replace(with_check, '\\s+', ' ', 'g'), '-') as check
  from pg_policies where schemaname not like 'pg\\_%' and schemaname <> 'information_schema' order by 1, 2`;

export async function readPolicies(c: pg.ClientBase | pg.Pool): Promise<PolicyRow[]> {
  return (await c.query<PolicyRow>(POLICIES_SQL)).rows;
}

export const policyLine = (r: PolicyRow): string => [r.relation, r.name, r.cmd, r.roles, r.permissive, r.using, r.check].join("\t");

export function expectedPolicies(): PolicyRow[] {
  return readFileSync(join(ROOT, "test", "policies", "expected.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l, i) => {
      const cells = l.split("\t");
      if (cells.length !== 7) throw new Error(`policies/expected.tsv:${String(i + 1)}: expected 7 cells, got ${String(cells.length)}`);
      const [relation = "", name = "", cmd = "", roles = "", permissive = "", using = "", check = ""] = cells;
      return { relation, name, cmd, roles, permissive, using, check };
    });
}

/** The domain an own_insert policy admits (`s.domain = '<d>'` in its with check), or null. */
export function domainOf(check: string): string | null {
  return /s\.domain = '([a-z_]+)'::text/.exec(check)?.[1] ?? null;
}

/* v8 ignore start — the generator, run by hand */
if (import.meta.filename === process.argv[1]) {
  const c = new pg.Client({ connectionString: process.argv[2] });
  await c.connect();
  const rows = await readPolicies(c);
  await c.end();
  process.stdout.write(
    "# Every row-level security policy of ours (test/policies.ts): relation, policy, command, roles, permissive, using, with check.\n# A migration that adds, changes or drops a policy changes its row here in the same commit.\n" +
      rows.map((r) => `${policyLine(r)}\n`).join(""),
  );
}
/* v8 ignore stop */
