/**
 * 0341: stop_times_stop (gtfs_feed_key, stop_id, trip_id) is back, so a read
 * that asks only whether a stop has times is answered by an index.
 *
 *  - the index is there, VALID, with its definition;
 *  - a stop_id read with no predicate on departure or arrival plans through
 *    it; the partial stop_tod indexes cannot answer it;
 *  - the file run again (production built the index by hand first) is a
 *    no-op that applies outside a transaction.
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { describe, expect, it } from "vitest";
import { migratedSuite, reapply } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0341 stop_times_stop restored", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0341 test did not run");
    });
  });
}

const FILE = "0341_stop_times_stop_restore.sql";
const DEF = "CREATE INDEX stop_times_stop ON public.stop_times USING btree (gtfs_feed_key, stop_id, trip_id)";
const INDEX = `select pg_get_indexdef(i.indexrelid) as def, i.indisvalid as valid
  from pg_index i where i.indexrelid = 'public.stop_times_stop'::regclass`;

describe.skipIf(url === undefined)("0341 stop_times_stop restored", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "stopstop");

  it("is there, VALID, with its definition", async () => {
    const { rows } = await t.pool.query<{ def: string; valid: boolean }>(INDEX);
    expect(rows).toEqual([{ def: DEF, valid: true }]);
  });

  it("answers a stop's has-times read, which names neither departure nor arrival", async () => {
    const c = await t.pool.connect();
    try {
      await c.query("set enable_seqscan = off");
      const { rows } = await c.query<{ "QUERY PLAN": string }>(
        "explain (costs off) select exists (select 1 from stop_times st where st.gtfs_feed_key = 1::smallint and st.stop_id = 'de:1:1' and st.deleted_at is null)",
      );
      expect(rows.map((r) => r["QUERY PLAN"]).join("\n")).toMatch(/Index (Only )?Scan using stop_times_stop on/);
    } finally {
      await c.query("reset enable_seqscan");
      c.release();
    }
  });

  it("run again where the index is already there (production built it by hand) is a no-op, outside a transaction", async () => {
    await reapply(t, service(), FILE);
    const { rows } = await t.pool.query<{ def: string; valid: boolean }>(INDEX);
    expect(rows).toEqual([{ def: DEF, valid: true }]);
  });
});
