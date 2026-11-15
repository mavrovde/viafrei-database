/**
 * What the schema behaviour tests (#32: functions, triggers, views) share on
 * top of DomainDb: the missing-database guard, a typed row read, and the
 * refusal of a statement with its SQLSTATE, DETAIL and message.
 */
import { describe, expect, it } from "vitest";
import type pg from "pg";

export const url = process.env["TEST_DATABASE_URL"];

/** With VF_REQUIRE_DB=1 and no database, a failing test instead of a silent skip. */
export function requireDb(name: string): void {
  if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
    describe(name, () => {
      it("has a database to run against", () => {
        expect.fail(`VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — ${name} did not run`);
      });
    });
  }
}

/** A client or a pool: a read needs only query(). */
export type Queryable = Pick<pg.ClientBase, "query">;

export async function rows<R extends pg.QueryResultRow>(c: Queryable, sql: string, params: unknown[] = []): Promise<R[]> {
  return (await c.query<R>(sql, params)).rows;
}

export async function one<R extends pg.QueryResultRow>(c: Queryable, sql: string, params: unknown[] = []): Promise<R> {
  const r = await rows<R>(c, sql, params);
  if (r.length !== 1) throw new Error(`expected one row, got ${String(r.length)}: ${sql}`);
  return r[0] as R;
}

export type Refused = { code: string | undefined; detail: string | undefined; message: string } | null;

/** The refusal of a statement, run inside a savepoint so the transaction stays usable; null when it ran. */
export async function refused(c: pg.ClientBase, sql: string, params: unknown[] = []): Promise<Refused> {
  await c.query("savepoint refused");
  try {
    await c.query(sql, params);
    await c.query("release savepoint refused");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint refused");
    const x = e as { code?: string; detail?: string; message: string };
    return { code: x.code, detail: x.detail, message: x.message };
  }
}
