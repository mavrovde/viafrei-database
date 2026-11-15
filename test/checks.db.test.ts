/**
 * Every CHECK constraint of ours, held in both directions against a database
 * migrated to head, and each one made to refuse (#32 checks):
 *
 *   catalogue → table   every check of ours is a row of test/checks/constraints.tsv,
 *                       definition for definition (pg_get_constraintdef);
 *   table → catalogue   every row of it is a check the database holds;
 *   refusal             each row's plant is refused with SQLSTATE 23514 and
 *                       exactly that constraint's name, and the same row is
 *                       ACCEPTED once that one check is lifted too, so the
 *                       refusal is the check's and not another guard's.
 *
 * How a plant isolates its check is test/checks.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CheckRow, checkLine, expectedChecks, plant, readChecks } from "./checks.js";
import { DomainDb } from "./domain-db.js";

const db = new DomainDb(process.env["TEST_DATABASE_URL"] ?? "", "checks");
let held: { relation: string; name: string; def: string }[] = [];

beforeAll(async () => {
  await db.make([]);
  const c = await db.pool.connect();
  try {
    held = await readChecks(c);
  } finally {
    c.release();
  }
});
afterAll(async () => {
  await db.drop();
});

const id = (r: { relation: string; name: string }): string => `${r.relation}.${r.name}`;

/** Every row of one schema whose plant is not refused by its own check alone, with what happened. */
async function unrefused(schema: string): Promise<{ checked: number; wrong: string[] }> {
  const rows = expectedChecks().filter((r) => r.relation.startsWith(`${schema}.`));
  const wrong: string[] = [];
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    for (const r of rows) {
      if (r.plant === null) {
        wrong.push(`${id(r)}: no plant`);
        continue;
      }
      const got = await plant(c, r.relation, r.plant, r.name);
      if (got.code !== "23514" || got.constraint !== r.name) wrong.push(`${id(r)}: ${JSON.stringify(got)}`);
      const lifted = await plant(c, r.relation, r.plant, r.name, true);
      if (lifted.code !== null) wrong.push(`${id(r)} lifted: ${JSON.stringify(lifted)}`);
    }
  } finally {
    await c.query("rollback");
    c.release();
  }
  return { checked: rows.length, wrong };
}

describe("the check table", () => {
  it("parses, is sorted and unique, and carries a plant for every check", () => {
    const rows = expectedChecks();
    const ids = rows.map(id);
    expect(rows.length).toBeGreaterThan(700);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows.map((r) => `${r.relation}\t${r.name}`)).toEqual(rows.map((r) => `${r.relation}\t${r.name}`).sort());
    expect(rows.filter((r) => r.plant === null || Object.keys(r.plant).length === 0).map(id)).toEqual([]);
    expect(rows.every((r) => r.def.startsWith("CHECK ("))).toBe(true);
  });

  it("round-trips a definition holding a newline, a tab and a backslash", () => {
    const r: CheckRow = { relation: "a.b", name: "c", def: "CHECK ((x ~ '\\d'\n\tAND y))", plant: { x: "1" } };
    expect(checkLine(r).split("\t")).toHaveLength(4);
    expect(checkLine(r)).not.toContain("\n");
  });
});

describe("every check, catalogue and table both ways", () => {
  it("every check of ours is a row of the table, definition for definition", () => {
    const want = new Set(expectedChecks().map((r) => `${id(r)}\t${r.def}`));
    expect(held.map((r) => `${id(r)}\t${r.def}`).filter((k) => !want.has(k))).toEqual([]);
  });

  it("every row of the table is a check the database holds", () => {
    const have = new Set(held.map((r) => `${id(r)}\t${r.def}`));
    expect(expectedChecks().map((r) => `${id(r)}\t${r.def}`).filter((k) => !have.has(k))).toEqual([]);
    expect(held.length).toBe(expectedChecks().length);
  });
});

describe("every check refuses its plant by name, and only it", () => {
  it("every check of schema control refuses its plant with its own name", async () => {
    const r = await unrefused("control");
    expect(r.wrong).toEqual([]);
    expect(r.checked).toBeGreaterThan(20);
  });

  it("every check of schema domains refuses its plant with its own name", async () => {
    const r = await unrefused("domains");
    expect(r.wrong).toEqual([]);
    expect(r.checked).toBeGreaterThan(100);
  });

  it("every check of schema ingestor refuses its plant with its own name", async () => {
    const r = await unrefused("ingestor");
    expect(r.wrong).toEqual([]);
    expect(r.checked).toBeGreaterThan(15);
  });

  it("every check of schema public refuses its plant with its own name", { timeout: 600_000 }, async () => {
    const r = await unrefused("public");
    expect(r.wrong).toEqual([]);
    expect(r.checked).toBeGreaterThan(500);
  });

  it("a plant the check allows is not reported as a refusal", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      expect(await plant(c, "public.ops_rollup_feed", { runs: "1" }, "ops_rollup_feed_runs_check")).toEqual({ code: null, constraint: null });
      expect(await plant(c, "public.ops_rollup_feed", { runs: "0" }, "ops_rollup_feed_runs_check")).toEqual({ code: "23514", constraint: "ops_rollup_feed_runs_check" });
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});
