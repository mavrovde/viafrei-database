/**
 * Every table of ours, held in both directions against a database migrated to
 * head, and its keys made to refuse (#32 tables):
 *
 *   shape         every column (type, NOT NULL, default, identity, generated),
 *                 every non-check constraint and every index is a row of
 *                 test/tables/shape.tsv, and every row is held;
 *   NOT NULL      each NOT NULL column with no default refuses a null (23502,
 *                 that column);
 *   primary key   two rows equal on it are refused (23505, that key — on a
 *                 partitioned table the day partition's index of it);
 *   unique        likewise for each unique constraint;
 *   foreign key   a row naming no referenced row is refused (23503, that key).
 *
 * Each plant lifts every other guard (test/checks.ts liftGuards) inside a
 * savepoint of a rolled-back owner transaction, so the refusal is the one
 * under test. The checks are test/checks.db.test.ts.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liftGuards } from "./checks.js";
import { DomainDb } from "./domain-db.js";
import { expectedShape, keyValue, otherValue, readShape, type ShapeRow, shapeLine } from "./tables.js";

const db = new DomainDb(process.env["TEST_DATABASE_URL"] ?? "", "tables");
let held: ShapeRow[] = [];

beforeAll(async () => {
  await db.make([]);
  const c = await db.pool.connect();
  try {
    held = await readShape(c);
  } finally {
    c.release();
  }
});
afterAll(async () => {
  await db.drop();
});

type Key = { readonly name: string; readonly type: "p" | "u" | "f"; readonly self: boolean; readonly columns: { name: string; type: string }[] };

/** The tables of one schema with their NOT NULL columns without a default, and their p/u/f keys. */
async function tablesOf(c: pg.ClientBase, schema: string): Promise<{ relation: string; required: string[]; keys: Key[] }[]> {
  const r = await c.query<{ relation: string; required: string[]; keys: Key[] | null }>(
    `select n.nspname || '.' || c.relname as relation,
            coalesce((select array_agg(a.attname::text order by a.attnum) from pg_attribute a
                       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attnotnull and not a.atthasdef
                         and a.attidentity = '' and a.attgenerated = ''), '{}') as required,
            (select json_agg(json_build_object('name', k.conname, 'type', k.contype, 'self', k.confrelid = c.oid,
                     'columns', (select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by o.n)
                                   from unnest(k.conkey) with ordinality o(attnum, n) join pg_attribute a on a.attrelid = c.oid and a.attnum = o.attnum)) order by k.conname)
               from pg_constraint k where k.conrelid = c.oid and k.contype in ('p', 'u', 'f')) as keys
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('r', 'p') and not c.relispartition
        and c.oid not in (select objid from pg_depend where deptype = 'e')
      order by 1`,
    [schema],
  );
  return r.rows.map((x) => ({ relation: x.relation, required: x.required, keys: x.keys ?? [] }));
}

/** The constraint an error names, as the parent's when it is a day partition's index of it. */
async function parentName(c: pg.ClientBase, name: string | undefined): Promise<string | undefined> {
  if (name === undefined) return undefined;
  const r = await c.query<{ p: string }>(
    "select pi.relname as p from pg_inherits i join pg_class ci on ci.oid = i.inhrelid join pg_class pi on pi.oid = i.inhparent where ci.relname = $1 and ci.relkind = 'i'",
    [name],
  );
  return r.rows[0]?.p ?? name;
}

type Refusal = { code: string | undefined; constraint: string | undefined; column: string | undefined; parent: string | undefined };

/**
 * `lift` (the guards lifted) then the inserts it returns, in a savepoint rolled
 * back after; the inserts' error with the constraint it names resolved to its
 * parent's before that rollback, while a plant's default partition still exists.
 */
async function attempt(c: pg.PoolClient, lift: (c: pg.PoolClient) => Promise<(c: pg.PoolClient) => Promise<unknown>>): Promise<Refusal | null> {
  await c.query("savepoint t");
  try {
    const act = await lift(c);
    await c.query("savepoint s");
    try {
      await act(c);
      return null;
    } catch (e) {
      await c.query("rollback to savepoint s");
      const r = e as Partial<Refusal>;
      return { code: r.code, constraint: r.constraint, column: r.column, parent: await parentName(c, r.constraint) };
    }
  } finally {
    await c.query("rollback to savepoint t");
  }
}

/** Every key and NOT NULL of one schema's tables that does not refuse as it should. */
async function unrefused(schema: string): Promise<{ wrong: string[]; counts: Record<string, number> }> {
  const wrong: string[] = [];
  const counts: Record<string, number> = { tables: 0, notnull: 0, p: 0, u: 0, f: 0 };
  await db.planted(async (c) => {
    for (const t of await tablesOf(c, schema)) {
      counts["tables"] = (counts["tables"] ?? 0) + 1;
      for (const col of t.required) {
        counts["notnull"] = (counts["notnull"] ?? 0) + 1;
        const e = await attempt(c, async (x) => {
          const q = (await liftGuards(x, t.relation, [col], null))({ [col]: null });
          return async (y) => y.query(q.sql, q.values);
        });
        if (e?.code !== "23502" || e.column !== col) wrong.push(`${t.relation}.${col} not null: ${JSON.stringify(e)}`);
      }
      for (const k of t.keys) {
        counts[k.type] = (counts[k.type] ?? 0) + 1;
        const row = Object.fromEntries(k.columns.map((col) => [col.name, keyValue(col.type)]));
        const cols = k.columns.map((col) => col.name);
        const e = await attempt(c, async (x) => {
          // A key onto its own table needs the key it names kept, and a row of its own that is not the one it names.
          const own = k.type === "f" && k.self ? (t.keys.find((p) => p.type === "p")?.columns ?? []) : [];
          const insert = await liftGuards(x, t.relation, [...cols, ...own.map((col) => col.name)], null, { pk: k.type === "p" || own.length > 0, fks: k.type === "f" });
          const q = insert({ ...row, ...Object.fromEntries(own.map((col) => [col.name, otherValue(col.type)])) });
          return async (y) => {
            await y.query(q.sql, q.values);
            if (k.type !== "f") await y.query(q.sql, q.values);
          };
        });
        const want = k.type === "f" ? "23503" : "23505";
        const named = e?.code === want ? e.parent : undefined;
        if (named !== k.name) wrong.push(`${t.relation} ${k.type} ${k.name}: ${JSON.stringify(e)}`);
      }
    }
  });
  return { wrong, counts };
}

describe("every table, catalogue and table both ways", () => {
  it("every column, constraint and index of every table of ours is a row of the shape table", () => {
    const want = new Set(expectedShape().map(shapeLine));
    expect(held.map(shapeLine).filter((k) => !want.has(k))).toEqual([]);
  });

  it("every row of the shape table is held, and the table names every table of ours", () => {
    const have = new Set(held.map(shapeLine));
    expect(expectedShape().map(shapeLine).filter((k) => !have.has(k))).toEqual([]);
    expect(new Set(expectedShape().map((r) => r.relation)).size).toBe(229);
  });
});

// 229 tables: 1128 NOT NULL columns without a default, 214 primary keys, 62 unique constraints, 40 foreign keys.
describe("every table refuses a null, a duplicate key and a dangling reference by name", () => {
  it("every table of schema access refuses each null, duplicate key and dangling reference by name", async () => {
    const r = await unrefused("access");
    expect(r.wrong).toEqual([]);
    expect(r.counts).toEqual({ tables: 8, notnull: 47, p: 8, u: 0, f: 3 });
  });

  it("every table of schema control refuses each null, duplicate key and dangling reference by name", async () => {
    const r = await unrefused("control");
    expect(r.wrong).toEqual([]);
    expect(r.counts).toEqual({ tables: 10, notnull: 39, p: 10, u: 0, f: 4 });
  });

  it("every table of schema domains refuses each null, duplicate key and dangling reference by name", { timeout: 300_000 }, async () => {
    const r = await unrefused("domains");
    expect(r.wrong).toEqual([]);
    expect(r.counts).toEqual({ tables: 30, notnull: 116, p: 30, u: 30, f: 0 });
  });

  it("every table of schema ingestor refuses each null, duplicate key and dangling reference by name", async () => {
    const r = await unrefused("ingestor");
    expect(r.wrong).toEqual([]);
    expect(r.counts).toEqual({ tables: 6, notnull: 26, p: 6, u: 0, f: 5 });
  });

  it("every table of schema public refuses each null, duplicate key and dangling reference by name", { timeout: 900_000 }, async () => {
    const r = await unrefused("public");
    expect(r.wrong).toEqual([]);
    expect(r.counts).toEqual({ tables: 175, notnull: 900, p: 160, u: 32, f: 28 });
  });
});
