/**
 * 0354 and 0355: public.charging_point_status_newest, the newest status tick
 * of each (evse_id, source_feed), kept by row triggers on the partitioned
 * public.charging_point_status and filled from the ticks already held.
 *
 *  - a newer tick replaces the row, an older one never does; feeds are kept apart;
 *  - a tick written straight into a day partition made after 0354 (the
 *    schema's ensure_daily_partitions) fires the trigger;
 *  - an update or a delete of the held tick takes the newest tick left;
 *  - a retired day partition (detached and dropped) leaves the row;
 *  - no tick without an EVSE id exists to reach the trigger;
 *  - 0355 fills the newest tick of each key, and over a newer or an equal row
 *    keeps the row held;
 *  - api_reader and viafrei_mcp read the table, viafrei_digest the view only.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { describe, expect, it } from "vitest";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0354-0355 charging_point_status_newest", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0354 test did not run");
    });
  });
}

type Row = { evse_id: string; source_feed: string; status: string | null; h: number };

describe.skipIf(url === undefined)("0354-0355 charging_point_status_newest", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "cpsn0354");

  /** A tick `h` hours before the start of the current hour (inside the day partitions serve's boot makes). */
  const tick = async (evse: string, feed: string, h: number, status: string, into = "public.charging_point_status", at?: string): Promise<void> => {
    await t.pool.query(
      `insert into ${into} (observed_at, evse_id, source_feed, status, raw)
       values (coalesce($5::timestamptz, date_trunc('hour', now()) - make_interval(hours => $3)), $1, $2, $4, '{}'::jsonb)`,
      [evse, feed, h, status, at ?? null],
    );
  };

  /** The newest table's rows of `evse`, by feed; h = hours before the start of the current hour. */
  const newest = async (evse: string): Promise<Row[]> =>
    (
      await t.pool.query<Row>(
        `select evse_id, source_feed, status,
                round(extract(epoch from date_trunc('hour', now()) - observed_at) / 3600)::int as h
           from charging_point_status_newest where evse_id = $1 order by source_feed`,
        [evse],
      )
    ).rows;

  const fill = async (): Promise<void> => {
    await t.pool.query("delete from schema_migrations where version = 355");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying"))).toEqual(["applying 0355_charging_point_status_newest_fill.sql"]);
  };

  it("a newer tick replaces the point's row, an older one never does, and each feed keeps its own row", async () => {
    await tick("E1", "fa", 5, "available");
    expect(await newest("E1")).toEqual([{ evse_id: "E1", source_feed: "fa", status: "available", h: 5 }]);
    await tick("E1", "fa", 2, "occupied");
    expect(await newest("E1")).toEqual([{ evse_id: "E1", source_feed: "fa", status: "occupied", h: 2 }]);
    await tick("E1", "fa", 9, "faulted");
    expect(await newest("E1")).toEqual([{ evse_id: "E1", source_feed: "fa", status: "occupied", h: 2 }]);
    await tick("E1", "fb", 7, "available");
    expect(await newest("E1")).toEqual([
      { evse_id: "E1", source_feed: "fa", status: "occupied", h: 2 },
      { evse_id: "E1", source_feed: "fb", status: "available", h: 7 },
    ]);
  });

  it("a tick written straight into a day partition made after 0354 fires the trigger", async () => {
    await t.pool.query("select ensure_daily_partitions(40)");
    const day = (
      await t.pool.query<{ part: string; at: string }>(
        `select 'public.charging_point_status_' || to_char(d, 'YYYYMMDD') as part, (d + interval '6 hours')::text as at
           from (select (now() at time zone 'UTC')::date + 38 as d) x`,
      )
    ).rows[0];
    expect(day).toBeDefined();
    const made = await t.pool.query("select 1 from pg_inherits where inhrelid = $1::regclass and inhparent = 'public.charging_point_status'::regclass", [day?.part]);
    expect(made.rowCount).toBe(1);
    await tick("E2", "fa", 0, "available", day?.part, day?.at);
    const r = await t.pool.query<{ status: string; same: boolean }>(
      "select status, observed_at = $1::timestamptz as same from charging_point_status_newest where evse_id = 'E2' and source_feed = 'fa'",
      [day?.at],
    );
    expect(r.rows).toEqual([{ status: "available", same: true }]);
  });

  it("an update of the held tick restates the row; a delete of it takes the newest tick left, none left no row", async () => {
    await tick("E3", "fa", 6, "available");
    await tick("E3", "fa", 3, "occupied");
    await t.pool.query("update charging_point_status set status = 'faulted' where evse_id = 'E3' and observed_at = date_trunc('hour', now()) - interval '3 hours'");
    expect(await newest("E3")).toEqual([{ evse_id: "E3", source_feed: "fa", status: "faulted", h: 3 }]);
    await t.pool.query("update charging_point_status set observed_at = date_trunc('hour', now()) - interval '1 hour' where evse_id = 'E3' and observed_at = date_trunc('hour', now()) - interval '6 hours'");
    expect(await newest("E3")).toEqual([{ evse_id: "E3", source_feed: "fa", status: "available", h: 1 }]);
    await t.pool.query("delete from charging_point_status where evse_id = 'E3' and observed_at = date_trunc('hour', now()) - interval '1 hour'");
    expect(await newest("E3")).toEqual([{ evse_id: "E3", source_feed: "fa", status: "faulted", h: 3 }]);
    await t.pool.query("delete from charging_point_status where evse_id = 'E3'");
    expect(await newest("E3")).toEqual([]);
  });

  it("a day partition retired whole (detached, dropped) leaves the point's row", async () => {
    await t.pool.query("select ensure_daily_partitions(40)");
    const at = (await t.pool.query<{ at: string }>("select ((now() at time zone 'UTC')::date + 39 + interval '1 hour')::text as at")).rows[0]?.at;
    const part = (await t.pool.query<{ p: string }>("select 'charging_point_status_' || to_char((now() at time zone 'UTC')::date + 39, 'YYYYMMDD') as p")).rows[0]?.p;
    await tick("E4", "fa", 0, "occupied", undefined, at);
    await t.pool.query(`alter table public.charging_point_status detach partition public.${part ?? ""}`);
    await t.pool.query(`drop table public.${part ?? ""}`);
    const r = await t.pool.query<{ status: string }>("select status from charging_point_status_newest where evse_id = 'E4'");
    expect(r.rows).toEqual([{ status: "occupied" }]);
  });

  it("no tick without an EVSE id exists: the tick table and the newest table both refuse one", async () => {
    await expect(tick(null as unknown as string, "fa", 1, "available")).rejects.toMatchObject({ code: "23502" });
    await expect(
      t.pool.query("insert into charging_point_status_newest (evse_id, observed_at, source_feed) values (null, now(), 'fa')"),
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("0355 fills the newest tick of each point and feed from the ticks held", async () => {
    await tick("E5", "fa", 8, "available");
    await tick("E5", "fa", 4, "occupied");
    await tick("E5", "fb", 10, "faulted");
    await t.pool.query("delete from charging_point_status_newest where evse_id = 'E5'");
    expect(await newest("E5")).toEqual([]);
    await fill();
    expect(await newest("E5")).toEqual([
      { evse_id: "E5", source_feed: "fa", status: "occupied", h: 4 },
      { evse_id: "E5", source_feed: "fb", status: "faulted", h: 10 },
    ]);
  });

  it("0355 never replaces a row held for the same or a newer instant", async () => {
    await tick("E6", "fa", 4, "available");
    await t.pool.query("update charging_point_status_newest set status = 'kept-equal' where evse_id = 'E6'");
    await tick("E7", "fa", 4, "available");
    await t.pool.query("update charging_point_status_newest set observed_at = observed_at + interval '2 hours', status = 'kept-newer' where evse_id = 'E7'");
    await fill();
    expect((await newest("E6")).map((r) => r.status)).toEqual(["kept-equal"]);
    expect(await newest("E7")).toEqual([{ evse_id: "E7", source_feed: "fa", status: "kept-newer", h: 2 }]);
  });

  it("api_reader and viafrei_mcp read the table; viafrei_digest reads the view and not the table", async () => {
    const r = await t.pool.query<{ role: string; tbl: boolean; vw: boolean }>(
      `select r as role, has_table_privilege(r, 'public.charging_point_status_newest', 'select') as tbl,
              has_table_privilege(r, 'public.charging_point_status_newest_live', 'select') as vw
         from unnest(array['api_reader', 'viafrei_digest', 'viafrei_mcp']) r order by 1`,
    );
    expect(r.rows).toEqual([
      { role: "api_reader", tbl: true, vw: false },
      { role: "viafrei_digest", tbl: false, vw: true },
      { role: "viafrei_mcp", tbl: true, vw: false },
    ]);
  });
});
