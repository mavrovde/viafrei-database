/**
 * Every row-level security policy of ours, held in both directions against a
 * database migrated to head, and each one made to act (#32 policies):
 *
 *   catalogue → table   every policy is a row of test/policies/expected.tsv;
 *   table → catalogue   every row of it is a policy the database holds;
 *   behaviour, per domains table, as the roles the policies name:
 *     read        the PUBLIC read policy is not scoped: viafrei_ingestor, the
 *                 one role with SELECT on them, reads every source's rows;
 *     own insert  viafrei_ingestor writes a row of its own source when that
 *                 source is of the table's domain, and is refused (42501) a
 *                 row of another source, a row of its own source of another
 *                 domain, and any row with no source set;
 *     own update  it updates its own rows and no other, and cannot move a row
 *                 to another source; a table with no update policy lets it
 *                 update nothing.
 *
 * Every guard but RLS is lifted for the rows (test/checks.ts liftGuards), so a
 * refusal here is a policy's; the test connects as a superuser, which plants
 * through FORCE ROW LEVEL SECURITY, and runs as the roles by SET ROLE.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liftGuards } from "./checks.js";
import { DomainDb } from "./domain-db.js";
import { domainOf, expectedPolicies, policyLine, readPolicies } from "./policies.js";

type Table = { readonly relation: string; readonly domain: string; readonly update: boolean };

/**
 * The domains tables the ingestor writes by source: those with an insert
 * policy for viafrei_ingestor. domains.train_board_departures is appended by
 * the live ingestor under a policy of its own (0315), whose behaviour
 * test/train-board.db.test.ts proves.
 */
function tables(): Table[] {
  const rows = expectedPolicies();
  const ingestor = new Set(rows.filter((r) => r.cmd === "INSERT" && r.roles === "viafrei_ingestor").map((r) => r.relation));
  return [...new Set(rows.map((r) => r.relation))].filter((relation) => ingestor.has(relation)).map((relation) => {
    const own = rows.filter((r) => r.relation === relation);
    const insert = own.find((r) => r.cmd === "INSERT");
    const domain = insert === undefined ? null : domainOf(insert.check);
    if (domain === null) throw new Error(`${relation}: no own_insert policy naming a domain`);
    return { relation, domain, update: own.some((r) => r.cmd === "UPDATE") };
  });
}

const domains = (): string[] => [...new Set(tables().map((t) => t.domain))].sort();
const db = new DomainDb(process.env["TEST_DATABASE_URL"] ?? "", "policies");

beforeAll(async () => {
  await db.make(domains().flatMap((d) => [[`${d}-a`, d, 50] as const, [`${d}-b`, d, 50] as const]));
});
afterAll(async () => {
  await db.drop();
});

/** In one rolled-back owner transaction: lift the guards, plant a row of source a and one of b, then run fn. */
async function withRows<R>(t: Table, fn: (c: pg.PoolClient, insert: (source: string) => { sql: string; values: (string | null)[] }) => Promise<R>): Promise<R> {
  return db.planted(async (c) => {
    const insert = await liftGuards(c, t.relation, ["source_id"], null);
    for (const s of [`${t.domain}-a`, `${t.domain}-b`]) {
      const q = insert({ source_id: s });
      await c.query(q.sql, q.values);
    }
    return fn(c, (source) => insert({ source_id: source }));
  });
}

/** A statement's SQLSTATE inside a savepoint, or "ok" with its row count. */
async function attempt(c: pg.PoolClient, sql: string, values: (string | null)[] = []): Promise<string> {
  await c.query("savepoint a");
  try {
    const r = await c.query(sql, values);
    return `ok ${String(r.rowCount ?? 0)}`;
  } catch (e) {
    return (e as { code?: string }).code ?? "?";
  } finally {
    await c.query("rollback to savepoint a");
  }
}

describe("the policy table", () => {
  it("every policy of ours is a row of the table, and every row a policy the database holds", async () => {
    const held = (await readPolicies(db.pool)).map(policyLine);
    const want = expectedPolicies().map(policyLine);
    expect(held.filter((k) => !want.includes(k))).toEqual([]);
    expect(want.filter((k) => !held.includes(k))).toEqual([]);
    expect(want.length).toBe(86);
  });

  it("every domains table with policies has a read, an own insert naming its domain, and at most an own update", () => {
    const rows = expectedPolicies();
    for (const t of tables()) {
      const names = rows.filter((r) => r.relation === t.relation).map((r) => `${r.cmd}:${r.roles}`).sort();
      expect(names, t.relation).toEqual(t.update ? ["INSERT:viafrei_ingestor", "SELECT:public", "UPDATE:viafrei_ingestor"] : ["INSERT:viafrei_ingestor", "SELECT:public"]);
    }
    expect(tables().length).toBe(30);
  });
});

describe("every policy acts", () => {
  it("read: the PUBLIC read policy lets the one role that may select (the ingestor) read every source's rows, as one source and with none set", async () => {
    const wrong: string[] = [];
    for (const t of tables()) {
      await withRows(t, async (c) => {
        await c.query("set local role viafrei_ingestor");
        for (const setting of [`${t.domain}-a`, ""]) {
          await c.query("select set_config('viafrei.source_id', $1, true)", [setting]);
          const got = await attempt(c, `select 1 from ${t.relation} where source_id in ($1, $2)`, [`${t.domain}-a`, `${t.domain}-b`]);
          if (got !== "ok 2") wrong.push(`${t.relation} as ${setting || "no source"}: ${got}`);
        }
      });
    }
    expect(wrong).toEqual([]);
  });

  it("own insert: the ingestor writes its own source's row of the table's domain and is refused another source's, another domain's and a row with no source set", async () => {
    const wrong: string[] = [];
    const other = (d: string): string => `${domains().find((x) => x !== d) ?? ""}-a`;
    for (const t of tables()) {
      await withRows(t, async (c, insert) => {
        await c.query("set local role viafrei_ingestor");
        const own = insert(`${t.domain}-a`);
        const cases: [string, string | null, string, string][] = [
          ["own", `${t.domain}-a`, `${t.domain}-a`, "ok 1"],
          ["another source", `${t.domain}-a`, `${t.domain}-b`, "42501"],
          ["another domain", other(t.domain), other(t.domain), "42501"],
          ["no source set", null, `${t.domain}-a`, "42501"],
        ];
        for (const [what, setting, source, want] of cases) {
          await c.query("select set_config('viafrei.source_id', $1, true)", [setting ?? ""]);
          const q = insert(source);
          const got = await attempt(c, q.sql, q.values);
          if (got !== want) wrong.push(`${t.relation} ${what}: ${got}`);
        }
        expect(own.sql).toContain(t.relation);
      });
    }
    expect(wrong).toEqual([]);
  });

  it("own update: the ingestor updates its own rows and no other, and cannot move one to another source; with no update policy it updates nothing", async () => {
    const wrong: string[] = [];
    for (const t of tables()) {
      await withRows(t, async (c) => {
        await c.query("set local role viafrei_ingestor");
        await c.query("select set_config('viafrei.source_id', $1, true)", [`${t.domain}-a`]);
        const all = await attempt(c, `update ${t.relation} set source_id = source_id where source_id in ($1, $2)`, [`${t.domain}-a`, `${t.domain}-b`]);
        const move = await attempt(c, `update ${t.relation} set source_id = $2 where source_id = $1`, [`${t.domain}-a`, `${t.domain}-b`]);
        if (t.update) {
          if (all !== "ok 1") wrong.push(`${t.relation} own: ${all}`);
          if (move !== "42501") wrong.push(`${t.relation} move: ${move}`);
        } else if (all !== "ok 0" && all !== "42501") {
          wrong.push(`${t.relation} with no update policy: ${all}`);
        }
      });
    }
    expect(wrong).toEqual([]);
  });
});
