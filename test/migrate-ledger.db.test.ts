/**
 * A migration file that never reaches its own ledger insert while psql exits
 * 0, through real psql (#31 finding): `\q` ends the session before the insert;
 * `\set ON_ERROR_STOP off` before an error leaves the transaction aborted,
 * the insert ignored and the commit a rollback. (An unterminated quote, dollar
 * quote, comment or \if is NOT this case: psql exits 3 on it.) migrate must
 * fail naming the file, record nothing of it and apply nothing after it.
 */
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { describeFile } from "../src/migrations/files.js";
import { migrate } from "../src/migrations/migrate.js";
import { psqlRunner } from "../src/psql.js";

const base = process.env["TEST_DATABASE_URL"] ?? "";
const name = `test_vfdb_ledger_${String(process.pid)}`;
const admin = new pg.Pool({ connectionString: base, max: 1 });
const own = new URL(base);
own.pathname = `/${name}`;

afterAll(async () => {
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

describe("a file that never reaches its ledger insert", () => {
  it.each([
    ["quits psql", "create table zz_lost (id int);\n\\q\n"],
    ["switches ON_ERROR_STOP off and fails", "create table zz_lost (id int);\n\\set ON_ERROR_STOP off\nselect 1/0;\n"],
  ])("fails non-zero naming the file, records nothing of it and applies nothing after it, when the file %s", async (_what, body) => {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    const files = [
      describeFile("0001_ok.sql", Buffer.from("create table zz_ok (id int);\n")),
      describeFile("0002_lost.sql", Buffer.from(body)),
      describeFile("0003_after.sql", Buffer.from("create table zz_after (id int);\n")),
    ];
    const err: string[] = [];
    const r = await migrate({ psql: psqlRunner({ databaseUrl: own.toString() }), files, out: () => undefined, err: (l) => err.push(l) });
    expect(r.exitCode).toBe(1);
    expect(r.applied).toEqual(["0001_ok.sql"]);
    expect(err.at(-1)).toMatch(/^✗ 0002_lost\.sql: psql exited 0 but version 2 is not in schema_migrations/);
    const c = new pg.Client({ connectionString: own.toString() });
    await c.connect();
    try {
      expect((await c.query<{ v: number }>("select version as v from schema_migrations order by 1")).rows.map((x) => x.v)).toEqual([1]);
      expect((await c.query<{ t: string | null; a: string | null }>("select to_regclass('zz_lost')::text as t, to_regclass('zz_after')::text as a")).rows[0]).toEqual({ t: null, a: null });
    } finally {
      await c.end();
    }
  });
});
