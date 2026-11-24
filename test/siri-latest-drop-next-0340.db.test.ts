/**
 * 0340: delfi_siri_et_calls_latest_next is dropped, so an upsert that changes
 * only a call's expected time is a HOT update.
 *
 *  - the table keeps its three other indexes, VALID, with their definitions,
 *    and has no index on expected_dep;
 *  - an update of expected_dep and delay_s alone is HOT; with the dropped
 *    index built again, the same update is not: the index was the cause;
 *  - the readers' predicates (each bounds aimed_dep) are answered through
 *    (stop_ref, aimed_dep), custom and generic plan;
 *  - the file run again (production dropped the index by hand first) is a
 *    no-op that applies outside a transaction.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { describe, expect, it } from "vitest";
import { migratedSuite, reapply } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0340 SIRI ET latest without _next", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0340 test did not run");
    });
  });
}

const FILE = "0340_siri_latest_drop_next.sql";

const DEFS = [
  {
    name: "delfi_siri_et_calls_latest_contract_ref_aimed",
    def: "CREATE INDEX delfi_siri_et_calls_latest_contract_ref_aimed ON public.delfi_siri_et_calls_latest USING btree (stop_ref, aimed_dep)",
  },
  {
    name: "delfi_siri_et_calls_latest_departed",
    def: "CREATE INDEX delfi_siri_et_calls_latest_departed ON public.delfi_siri_et_calls_latest USING btree (aimed_dep)",
  },
  {
    name: "delfi_siri_et_calls_latest_pkey",
    def: "CREATE UNIQUE INDEX delfi_siri_et_calls_latest_pkey ON public.delfi_siri_et_calls_latest USING btree (stop_ref, service_day, journey_ref, visit, source_feed)",
  },
].map((d) => ({ ...d, valid: true }));

const INDEXES = `select c.relname as name, pg_get_indexdef(i.indexrelid) as def, i.indisvalid as valid
  from pg_index i join pg_class c on c.oid = i.indexrelid
 where i.indrelid = 'public.delfi_siri_et_calls_latest'::regclass order by 1`;

const ROW = `insert into delfi_siri_et_calls_latest
  (stop_ref, service_day, journey_ref, visit, source_feed, observed_at, aimed_dep, expected_dep, delay_s, recorded, cancelled, journey_cancelled)
  values ($1, '2026-11-24', 'j', 1, 'delfi_siri_et', now(), now() + interval '10 minutes', now() + interval '10 minutes', 0, false, false, false)`;

/** The table's updates and HOT updates the connection has counted and not yet flushed. */
async function xact(c: import("pg").PoolClient): Promise<{ upd: number; hot: number }> {
  const { rows } = await c.query<{ upd: string; hot: string }>(
    "select n_tup_upd as upd, n_tup_hot_upd as hot from pg_stat_xact_user_tables where relid = 'public.delfi_siri_et_calls_latest'::regclass",
  );
  return { upd: Number(rows[0]?.upd ?? 0), hot: Number(rows[0]?.hot ?? 0) };
}

/** HOT updates of the table in the current transaction, after one update of the row's expected time alone. */
async function hotUpdate(t: { pool: import("pg").Pool }, stop: string): Promise<{ upd: number; hot: number }> {
  await t.pool.query(ROW, [stop]);
  const c = await t.pool.connect();
  try {
    await c.query("begin");
    // The view also counts this connection's earlier transactions not yet
    // flushed to the cumulative statistics, so the update is the difference.
    const before = await xact(c);
    await c.query(
      `update delfi_siri_et_calls_latest set expected_dep = expected_dep + interval '3 minutes', delay_s = 180, observed_at = now()
        where stop_ref = $1`,
      [stop],
    );
    const after = await xact(c);
    await c.query("rollback");
    return { upd: after.upd - before.upd, hot: after.hot - before.hot };
  } finally {
    c.release();
  }
}

/** The readers' predicates on the table: each bounds aimed_dep (the platform's departures read and station block, the API's relation). */
const READS = [
  {
    name: "departures",
    sql: `select c.aimed_dep from delfi_siri_et_calls_latest c
           where c.stop_ref = (select $1::text) and coalesce(c.expected_dep, c.aimed_dep) >= (select $2::timestamptz)
             and c.aimed_dep >= (select $2::timestamptz) - make_interval(secs => 21600) and c.aimed_dep <= (select $2::timestamptz) + interval '90 minutes'`,
  },
  {
    name: "board",
    sql: `select c.aimed_dep from delfi_siri_et_calls_latest c
           where c.stop_ref = (select $1::text) and coalesce(c.expected_dep, c.aimed_dep) >= (select $2::timestamptz) - interval '1 hour'
             and c.aimed_dep > (select $2::timestamptz) - interval '1 minute' and c.aimed_dep < (select $2::timestamptz) + interval '1 minute'`,
  },
];

describe.skipIf(url === undefined)("0340 SIRI ET latest without _next", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "sirinext");

  it("keeps the three other indexes VALID and indexes no expected_dep", async () => {
    const { rows } = await t.pool.query<{ name: string; def: string; valid: boolean }>(INDEXES);
    expect(rows).toEqual(DEFS);
    expect(rows.some((r) => r.def.includes("expected_dep"))).toBe(false);
  });

  it("makes an update of the expected time alone HOT, which the dropped index prevented", async () => {
    expect(await hotUpdate(t, "s-hot")).toEqual({ upd: 1, hot: 1 });
    await t.pool.query(
      "create index delfi_siri_et_calls_latest_next on public.delfi_siri_et_calls_latest (stop_ref, coalesce(expected_dep, aimed_dep))",
    );
    try {
      expect(await hotUpdate(t, "s-cold")).toEqual({ upd: 1, hot: 0 });
    } finally {
      await t.pool.query("drop index public.delfi_siri_et_calls_latest_next");
    }
  });

  it("answers the readers' predicates through (stop_ref, aimed_dep), custom and generic plan", async () => {
    await t.pool.query(`insert into delfi_siri_et_calls_latest
      (stop_ref, service_day, journey_ref, visit, source_feed, observed_at, aimed_dep, expected_dep, delay_s, recorded, cancelled, journey_cancelled)
      select 's' || (g % 500), '2026-11-24', 'j' || g, 1, 'delfi_siri_et', now(), now() + make_interval(mins => g % 1440),
             now() + make_interval(mins => g % 1440 + g % 7), (g % 7) * 60, false, false, false
        from generate_series(1, 20000) g`);
    await t.pool.query("analyze delfi_siri_et_calls_latest");
    const c = await t.pool.connect();
    try {
      for (const r of READS) {
        for (const mode of ["force_custom_plan", "force_generic_plan"]) {
          await c.query(`set plan_cache_mode = ${mode}`);
          await c.query(`prepare r_${r.name}(text, timestamptz) as ${r.sql}`);
          const { rows } = await c.query<{ "QUERY PLAN": string }>(`explain (costs off) execute r_${r.name}('s7', now())`);
          await c.query(`deallocate r_${r.name}`);
          expect(rows.map((x) => x["QUERY PLAN"]).join("\n"), `${r.name} ${mode}`).toMatch(
            /Index (Only )?Scan using delfi_siri_et_calls_latest_contract_ref_aimed/,
          );
        }
      }
    } finally {
      await c.query("reset plan_cache_mode");
      c.release();
    }
  });

  it("run again where the index is already gone (production dropped it by hand) is a no-op, outside a transaction", async () => {
    await reapply(t, service(), FILE);
    const { rows } = await t.pool.query<{ name: string; def: string; valid: boolean }>(INDEXES);
    expect(rows).toEqual(DEFS);
  });
});
