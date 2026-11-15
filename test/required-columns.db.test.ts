/**
 * The columns a source must fill, held by the schema (0302): each listed column
 * is NOT NULL, an insert that omits it is refused naming it, a text column also
 * refuses the empty string by a check of its own name, and the migration
 * refuses by table, column and count when a row already violates it, before it
 * changes anything; its rollback note undoes it and it applies again.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb, refusal } from "./domain-db.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("the required domain columns", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the required-columns test did not run");
    });
  });
}

const FILE = "0302_domain_required_columns.sql";
const SQL = readFileSync(new URL(`../db/migrations/${FILE}`, import.meta.url), "utf8");

/** The issue's list: table, column, text. */
const REQ: readonly (readonly [string, string, boolean])[] = [
  ["road_works", "title", true],
  ["speed_cameras", "kind", true],
  ["transit_agencies_odbl", "agency_name", true],
  ["transit_agencies_odbl", "agency_timezone", true],
  ["transit_agencies_odbl", "feed_version", true],
  ["transit_routes_odbl", "route_type", false],
  ["transit_routes_odbl", "feed_version", true],
  ["transit_service_dates_odbl", "service_id", true],
  ["transit_service_dates_odbl", "service_date", false],
  ["transit_service_dates_odbl", "feed_version", true],
  ["transit_stop_times_odbl", "trip_id", true],
  ["transit_stop_times_odbl", "stop_sequence", false],
  ["transit_stop_times_odbl", "stop_id", true],
  ["transit_stop_times_odbl", "feed_version", true],
  ["transit_stops_odbl", "stop_name", true],
  ["transit_stops_odbl", "feed_version", true],
  ["transit_trip_updates_odbl", "entity_id", true],
  ["transit_trips_odbl", "route_id", true],
  ["transit_trips_odbl", "service_id", true],
  ["transit_trips_odbl", "feed_version", true],
];
const TABLES = [...new Set(REQ.map(([t]) => t))];
const NONEMPTY = REQ.filter(([, , x]) => x).map(([a, b]) => `${a}_${b}_nonempty`);
const COUNT_NONEMPTY = "select count(*)::int as n from pg_constraint where connamespace = 'domains'::regnamespace and conname = any($1::text[])";

/** The rollback note of the file, as statements. */
const rollback = (): string =>
  SQL.split("\n")
    .slice(SQL.split("\n").indexOf("-- rollback:") + 1)
    .filter((l) => l.startsWith("--   alter table "))
    .map((l) => l.slice(5))
    .join("\n");

/** A value of a column's type that the not-null rule accepts. */
const DUMMY: Readonly<Record<string, string>> = { text: "'x'", integer: "1", bigint: "1", date: "date '2026-11-15'", "timestamp with time zone": "now()", jsonb: "'{}'::jsonb", boolean: "true" };

describe.skipIf(url === undefined)("the required domain columns", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "required");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  /** The table's other not-null columns a writer fills, each with a value of its type. */
  const filled = async (c: pg.PoolClient, table: string, omit: string): Promise<[string, string][]> => {
    const r = await c.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'domains' and table_name = $1 and is_nullable = 'NO' and column_default is null
          and is_identity = 'NO' and is_generated = 'NEVER' and column_name <> $2 order by ordinal_position`,
      [table, omit],
    );
    return r.rows.map((x) => {
      const v = x.column_name === "source_id" ? "'src-a'" : DUMMY[x.data_type];
      if (v === undefined) throw new Error(`${table}.${x.column_name}: no dummy for ${x.data_type}`);
      return [x.column_name, v];
    });
  };

  it("is applied", async () => {
    expect((await t.pool.query("select 1 from schema_migrations where version = 302 and name = $1", [FILE])).rowCount).toBe(1);
  });

  it("holds every listed column NOT NULL, and each text one non-empty by a check of its own name", async () => {
    for (const [table, col, text] of REQ) {
      const r = await t.pool.query<{ is_nullable: string }>("select is_nullable from information_schema.columns where table_schema = 'domains' and table_name = $1 and column_name = $2", [table, col]);
      expect(r.rows, `${table}.${col}`).toEqual([{ is_nullable: "NO" }]);
      const k = await t.pool.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::regclass and conname = $2",
        [`domains.${table}`, `${table}_${col}_nonempty`],
      );
      expect(k.rows, `${table}.${col}`).toEqual(text ? [{ def: `CHECK ((${col} <> ''::text))` }] : []);
    }
    const nonempty = await t.pool.query<{ n: number }>(COUNT_NONEMPTY, [NONEMPTY]);
    expect(nonempty.rows).toEqual([{ n: REQ.filter(([, , x]) => x).length }]);
  });

  it("refuses an insert that omits a listed column, naming it", async () => {
    for (const [table, col] of REQ) {
      await t.planted(async (c) => {
        const f = await filled(c, table, col);
        const sql = `insert into domains.${table} (${f.map(([k]) => k).join(", ")}) values (${f.map(([, v]) => v).join(", ")})`;
        const e = await refusal(c.query(sql));
        expect(e?.code, `${table}.${col}`).toBe("23502");
        expect(e?.message, `${table}.${col}`).toContain(`column "${col}" of relation "${table}"`);
      });
    }
  });

  it("refuses the empty string in a listed text column, by its check", async () => {
    for (const [table, col] of REQ.filter(([, , x]) => x)) {
      await t.planted(async (c) => {
        const f = await filled(c, table, col);
        // Every other check is lifted inside the rolled-back transaction, so only the non-empty check can refuse.
        const others = await c.query<{ conname: string }>(
          "select conname from pg_constraint where conrelid = $1::regclass and contype = 'c' and conname <> $2",
          [`domains.${table}`, `${table}_${col}_nonempty`],
        );
        for (const o of others.rows) await c.query(`alter table domains.${table} drop constraint ${o.conname}`);
        const sql = `insert into domains.${table} (${[...f.map(([k]) => k), col].join(", ")}) values (${[...f.map(([, v]) => v), "''"].join(", ")})`;
        const e = await refusal(c.query(sql));
        expect(e?.code, `${table}.${col}`).toBe("23514");
        expect(e?.message, `${table}.${col}`).toContain(`${table}_${col}_nonempty`);
      });
    }
  });

  it("refuses to apply over a violating row, naming each table, column and count, and changes nothing", async () => {
    await t.planted(async (c) => {
      await c.query(rollback());
      await c.query("insert into domains.road_works (source_id, external_id, title) values ('src-a', 'w1', ''), ('src-a', 'w2', null)");
      const f = await filled(c, "transit_routes_odbl", "route_type");
      await c.query(`insert into domains.transit_routes_odbl (${f.map(([k]) => k).join(", ")}) values (${f.map(([, v]) => v).join(", ")})`);
      await c.query("savepoint s");
      const e = await refusal(c.query(SQL));
      expect(e?.message).toBe("required columns not filled, nothing changed: domains.road_works.title: 2 row(s) null or empty; domains.transit_routes_odbl.route_type: 1 row(s) null; domains.transit_routes_odbl.feed_version: 1 row(s) null or empty");
      await c.query("rollback to savepoint s");
      const n = await c.query<{ n: number }>(COUNT_NONEMPTY, [NONEMPTY]);
      expect(n.rows).toEqual([{ n: 0 }]);
      const nullable = await c.query<{ n: number }>(
        `select count(*)::int as n from information_schema.columns where table_schema = 'domains' and is_nullable = 'YES'
            and (table_name, column_name) in (${REQ.map(([a, b]) => `('${a}', '${b}')`).join(", ")})`,
      );
      expect(nullable.rows).toEqual([{ n: REQ.length }]);
    });
  });

  it("is undone by its rollback note and applies again over clean rows", async () => {
    await t.planted(async (c) => {
      await c.query(rollback());
      const before = await c.query<{ n: number }>(COUNT_NONEMPTY, [NONEMPTY]);
      expect(before.rows).toEqual([{ n: 0 }]);
      await c.query("insert into domains.road_works (source_id, external_id, title) values ('src-a', 'w1', 'Baustelle')");
      await c.query(SQL);
      const after = await c.query<{ n: number }>(COUNT_NONEMPTY, [NONEMPTY]);
      expect(after.rows).toEqual([{ n: REQ.filter(([, , x]) => x).length }]);
      expect(TABLES.length).toBe(9);
    });
  });
});
