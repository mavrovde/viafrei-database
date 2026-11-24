/**
 * 0336: api_reader reads the platform relations the contract views read,
 * each by name, SELECT only; and still reads nothing else: not the access
 * store, not the tables under the owner-rights views it is given (the feed
 * catalogue, the runtime and scheduler state, the budget ledgers), not the
 * migration ledger; and it writes none of them.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_READER_BASE } from "./api-reader-base.js";
import { DomainDb, refusal } from "./domain-db.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("0336 api_reader base tables", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0336 test did not run");
    });
  });
}


/** Relations api_reader must still not read: the access store, the tables under its owner-rights views, the ledger. (gtfs_untimed_trips, under transit_punctuality_area_live, is granted by 0345.) */
const FORBIDDEN: readonly string[] = [
  "access.api_key",
  "access.audit",
  "access.console_enrolment",
  "access.console_passkey",
  "access.plan",
  "access.schema_version",
  "access.terms_acceptance",
  "access.usage",
  "public.feed_catalog",
  "public.registered_sources",
  "public.runtime_config",
  "public.source_schedule",
  "control.budgets",
  "control.budget_state",
  "control.feed_state",
  "control.refusals",
  "public.lez_zones",
  "public.station_slugs",
  "public.schema_migrations",
];

describe.skipIf(url === undefined)("0336 api_reader base tables", () => {
  const db = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "apibase");
  beforeAll(async () => {
    await db.make([]);
  }, 900_000);
  afterAll(async () => {
    await db.drop();
  });

  const as = async <R>(fn: (c: pg.PoolClient) => Promise<R>): Promise<R> =>
    db.planted(async (c) => {
      await c.query("set local role api_reader");
      return fn(c);
    });

  it("names 75 relations, every one present", async () => {
    expect(API_READER_BASE).toHaveLength(75);
    expect(new Set(API_READER_BASE).size).toBe(75);
    const r = await db.pool.query<{ n: string }>("select x.n from unnest($1::text[]) x(n) where to_regclass(x.n) is null", [API_READER_BASE]);
    expect(r.rows).toEqual([]);
  });

  it("are exactly the relations the contract views read, so a view's base is never missed", async () => {
    const r = await db.pool.query<{ n: string }>(
      `select distinct d.refobjid::regclass::text as n
         from pg_class v
         join pg_rewrite w on w.ev_class = v.oid
         join pg_depend d on d.objid = w.oid and d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
         join pg_class b on b.oid = d.refobjid
        where v.relnamespace = 'contract'::regnamespace and v.relkind = 'v' and d.refobjid <> v.oid and b.relnamespace <> 'contract'::regnamespace
        order by 1`,
    );
    const qualified = r.rows.map((x) => (x.n.includes(".") ? x.n : `public.${x.n}`)).sort((a, b) => a.localeCompare(b));
    expect(qualified).toEqual(API_READER_BASE);
  });

  it("api_reader reads every one of them, as itself", async () => {
    const failed: string[] = [];
    for (const n of API_READER_BASE) {
      try {
        await as((c) => c.query(`select 1 from ${n} limit 0`));
      } catch (e) {
        failed.push(`${n}: ${(e as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  });

  it("holds SELECT and nothing more on them, and USAGE on exactly contract, control, domains and public", async () => {
    const r = await db.pool.query<{ n: string; p: string }>(
      `select x.n, p from unnest($1::text[]) x(n) cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
        where has_table_privilege('api_reader', x.n, p)`,
      [API_READER_BASE],
    );
    expect(r.rows).toEqual([]);
    const sch = await db.pool.query<{ s: string }>(
      `select nspname || ' ' || p as s from pg_namespace cross join unnest(array['USAGE', 'CREATE']) p
        where nspname not like 'pg\\_%' and nspname <> 'information_schema' and has_schema_privilege('api_reader', oid, p) order by 1`,
    );
    expect(sch.rows.map((x) => x.s)).toEqual(["contract USAGE", "control USAGE", "domains USAGE", "public USAGE"]);
  });

  it("api_reader still cannot read the access store, the tables under its views or the ledger", async () => {
    const r = await db.pool.query<{ n: string }>("select x.n from unnest($1::text[]) x(n) where to_regclass(x.n) is null", [FORBIDDEN]);
    expect(r.rows).toEqual([]);
    for (const n of FORBIDDEN) {
      expect(await refusal(as((c) => c.query(`select 1 from ${n} limit 0`))), n).toMatchObject({ code: "42501" });
    }
  });

  it("api_reader writes none of them", async () => {
    expect(await refusal(as((c) => c.query("delete from public.stops")))).toMatchObject({ code: "42501" });
    expect(await refusal(as((c) => c.query("update public.gazetteer_places set name = name")))).toMatchObject({ code: "42501" });
  });
});
