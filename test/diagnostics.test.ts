/**
 * collect and readOnly over a planted pool; the SQL itself runs against a real
 * database in migrate.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import type pg from "pg";
import { collect, readOnly, SQL } from "../src/diagnostics.js";

function fakePool(answer: (sql: string) => unknown[] | Error): { pool: Pick<pg.Pool, "connect">; sent: string[]; released: () => number } {
  const sent: string[] = [];
  let released = 0;
  const client = {
    query: (sql: string) => {
      sent.push(sql);
      const a = answer(sql);
      return a instanceof Error ? Promise.reject(a) : Promise.resolve({ rows: a });
    },
    release: () => void (released += 1),
  };
  return { pool: { connect: () => Promise.resolve(client) } as unknown as Pick<pg.Pool, "connect">, sent, released: () => released };
}

describe("readOnly", () => {
  it("rolls back and rethrows the body's error, even when the rollback fails too, and always releases", async () => {
    const f = fakePool((sql) => (sql === "rollback" ? new Error("gone") : []));
    await expect(readOnly(f.pool, () => Promise.reject(new Error("statement timeout")))).rejects.toThrow("statement timeout");
    expect(f.sent).toEqual(["begin transaction read only", "set local statement_timeout = 5000", "rollback"]);
    expect(f.released()).toBe(1);
  });
});

describe("collect", () => {
  it("turns the bigint columns pg returns as text into numbers", async () => {
    const f = fakePool((sql) => {
      if (sql === SQL.versions) return [{ postgres: "PostgreSQL 16", postgis: "3.4", database: "test", now: new Date(0) }];
      if (sql === SQL.size) return [{ bytes: "1024" }];
      if (sql === SQL.largest) return [{ schema: "public", name: "t", kind: "r", bytes: "2048" }];
      if (sql === SQL.vacuum) return [{ schema: "public", name: "t", live: "10", dead: "2", dead_pct: 16.7, last_autovacuum: null, last_autoanalyze: null, autovacuums: "3" }];
      if (sql === SQL.wraparound) return [{ schema: "public", name: "t", xid_age: "99" }];
      if (sql === SQL.vacuumRunning) return [];
      if (sql.includes("to_regclass('schema_migrations')")) return [{ t: null }];
      return [];
    });
    const d = await collect(f.pool);
    expect([d.sizeBytes, d.largest[0]?.bytes, d.vacuum[0]?.live, d.vacuum[0]?.dead, d.vacuum[0]?.autovacuums, d.wraparound[0]?.xid_age]).toEqual([1024, 2048, 10, 2, 3, 99]);
    expect([d.vacuumRunning, d.ledgerTail]).toEqual([0, []]);
  });

  it("refuses an answer with no version row rather than reporting an empty database", async () => {
    const f = fakePool(() => []);
    await expect(collect(f.pool)).rejects.toThrow("version() returned no row");
  });
});
