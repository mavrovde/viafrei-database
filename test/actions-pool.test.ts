/**
 * analyze and check over a planted pool: every statement the action sends is
 * recorded, and each answer (or failure) is chosen per statement.
 */
import { describe, expect, it } from "vitest";
import type pg from "pg";
import { analyzeTable, check, RESOLVE_TABLE } from "../src/actions.js";
import { describeFile } from "../src/migrations/files.js";

type Answer = { rows: unknown[] } | Error;

/** A pool whose one client answers each statement through `answer`; `sent` records them, `released` counts releases. */
function fakePool(answer: (sql: string) => Answer = () => ({ rows: [] })): { pool: Pick<pg.Pool, "connect">; sent: string[]; released: () => number } {
  const sent: string[] = [];
  let released = 0;
  const client = {
    query: (sql: string): Promise<{ rows: unknown[] }> => {
      sent.push(sql);
      const a = answer(sql);
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    },
    release: (): void => {
      released += 1;
    },
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pick<pg.Pool, "connect">;
  return { pool, sent, released: () => released };
}

describe("analyze <table>", () => {
  it("refuses a name that is not a plain identifier before it connects", async () => {
    const f = fakePool();
    const r = await analyzeTable(f.pool, "t; drop table x");
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toMatch(/is not a table name/);
    expect(f.sent).toEqual([]);
  });
  it("says so when the catalogue knows no such table, and still resets and releases", async () => {
    const f = fakePool();
    const r = await analyzeTable(f.pool, "nothing_here");
    expect(r).toEqual({ ok: false, lines: ["✗ no table, partitioned table or materialized view named nothing_here"] });
    expect(f.sent).toEqual([RESOLVE_TABLE, "reset statement_timeout"]);
    expect(f.released()).toBe(1);
  });
  it("analyzes the name the catalogue returned, under the timeout it was given", async () => {
    const f = fakePool((sql) => (sql === RESOLVE_TABLE ? { rows: [{ qualified: "public.fuel_prices" }] } : { rows: [] }));
    const r = await analyzeTable(f.pool, "fuel_prices", 1234.9);
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toMatch(/^✓ analyze public\.fuel_prices in \d+ ms$/);
    expect(f.sent).toEqual([RESOLVE_TABLE, "set statement_timeout = 1234", "analyze public.fuel_prices", "reset statement_timeout"]);
    expect(f.released()).toBe(1);
  });
  it("reports a failed ANALYZE as a refusal, and a failed reset does not hide it", async () => {
    const f = fakePool((sql) => {
      if (sql === RESOLVE_TABLE) return { rows: [{ qualified: "public.t" }] };
      if (sql.startsWith("analyze")) return new Error("canceling statement due to statement timeout");
      if (sql.startsWith("reset")) return new Error("connection lost");
      return { rows: [] };
    });
    const r = await analyzeTable(f.pool, "public.t");
    expect(r).toEqual({ ok: false, lines: ["✗ analyze public.t failed: canceling statement due to statement timeout"] });
    expect(f.released()).toBe(1);
  });
});

describe("check over a database with no ledger", () => {
  it("reads the ledger as empty, so every file is pending", async () => {
    const files = [describeFile("0001_a.sql", Buffer.from("a\n"))];
    const f = fakePool((sql) => {
      if (sql.includes("to_regclass('schema_migrations')")) return { rows: [{ t: null }] };
      if (sql.includes("from pg_proc")) return { rows: [{ n: 0 }] };
      return { rows: [] };
    });
    const r = await check(f.pool, files);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toMatch(/0001_a\.sql/);
    expect(r.lines.join("\n")).toMatch(/ensure_daily_partitions\(\) does not exist/);
    expect(f.sent.some((s) => s.includes("from schema_migrations"))).toBe(false);
    expect(f.sent.at(-1)).toBe("commit");
  });
});
