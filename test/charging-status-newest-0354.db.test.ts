/**
 * 0354 and 0355: public.charging_point_status_newest, the newest status tick
 * of each (evse_id, source_feed). 0354 makes the table and fills it from the
 * ticks held; 0355 adds the row triggers on the partitioned
 * public.charging_point_status and catches up the ticks written in between.
 *
 *  - a newer tick replaces the row, an older one never does; feeds are kept
 *    apart; the row carries every column of the tick, value for value;
 *  - a tick written straight into a day partition made after 0354 (the
 *    schema's ensure_daily_partitions) fires the trigger;
 *  - an update or a delete of the held tick takes the newest tick left; an
 *    update of another tick to an instant older than the held one leaves it;
 *  - a retired day partition (detached and dropped) leaves the row;
 *  - no tick without an EVSE id exists to reach the trigger;
 *  - both files applied again from their rollbacks fill the newest tick of
 *    each key;
 *  - 0355's catch-up takes the ticks from 0354's start less an hour on, newer
 *    wins: it replaces an older row, keeps an equal or a newer one, and leaves
 *    a tick older than its margin;
 *  - api_reader and viafrei_mcp read the table, viafrei_digest the view only;
 *    the table has fillfactor 80.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0354-0355 charging_point_status_newest", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0354 test did not run");
    });
  });
}

const COLS = "evse_id, observed_at, feed_ts, last_updated, source_feed, status, operation_status, opening_status, exchange_protocol, confidentiality, source_run_id";
/** Every carried column as text, so a row compares whole. */
const AS_TEXT = COLS.split(", ")
  .map((c) => `${c}::text as ${c}`)
  .join(", ");
/** The rollback statements of a migration file, in order. */
const rollback = (file: string): string[] =>
  readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^-- {3}(drop|delete) /.test(l))
    .map((l) => l.replace(/^-- {3}/, ""));

type Row = Record<string, string | null>;

describe.skipIf(url === undefined)("0354-0355 charging_point_status_newest", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "cpsn0354");
  let run = 0;

  beforeAll(async () => {
    // the hour offsets below reach into yesterday's partition
    await t.pool.query("select ensure_daily_partitions(40)");
    const y = await t.pool.query(
      "select 1 from pg_inherits h join pg_class c on c.oid = h.inhrelid where h.inhparent = 'public.charging_point_status'::regclass and c.relname = 'charging_point_status_' || to_char((now() at time zone 'UTC')::date - 1, 'YYYYMMDD')",
    );
    expect(y.rowCount).toBe(1);
  });

  /** The instant `h` hours before the start of the current hour. */
  const at = (h: number): string => `date_trunc('hour', now()) - make_interval(hours => ${String(h)})`;

  /** A tick whose every carried column is its own value, told apart by `tag`; observed `h` hours back (or at `when`). */
  const tick = async (evse: string, feed: string, h: number, tag: string, opts: { into?: string; when?: string } = {}): Promise<void> => {
    run += 1;
    await t.pool.query(
      `insert into ${opts.into ?? "public.charging_point_status"}
         (observed_at, feed_ts, last_updated, evse_id, source_feed, status, operation_status, opening_status, exchange_protocol, confidentiality, source_run_id, raw)
       select o, o - interval '5 minutes', o - interval '10 minutes', $1, $2, $3, $3 || '-op', $3 || '-open', $3 || '-xp', $3 || '-conf', $4, '{}'::jsonb
         from (select coalesce($5::timestamptz, ${at(h)}) as o) x`,
      [evse, feed, tag, run, opts.when ?? null],
    );
  };

  /** The newest table's rows of `evse`, by feed, every column as text. */
  const newest = async (evse: string): Promise<Row[]> =>
    (await t.pool.query<Row>(`select ${AS_TEXT} from charging_point_status_newest where evse_id = $1 order by source_feed`, [evse])).rows;

  /** The tick of `evse` and `feed` with status `tag`, every carried column as text. */
  const tickRow = async (evse: string, feed: string, tag: string): Promise<Row> => {
    const r = await t.pool.query<Row>(`select ${AS_TEXT} from charging_point_status where evse_id = $1 and source_feed = $2 and status = $3`, [evse, feed, tag]);
    expect(r.rowCount).toBe(1);
    return r.rows[0] as Row;
  };

  const migrate = async (files: string[]): Promise<void> => {
    const r = await service().migrate("cli");
    expect(r.ok, r.lines.join("\n")).toBe(true);
    expect(r.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual(files);
  };

  it("a newer tick replaces the point's row with every column of it, an older one never does, and each feed keeps its own row", async () => {
    await tick("E1", "fa", 5, "a5");
    expect(await newest("E1")).toEqual([await tickRow("E1", "fa", "a5")]);
    await tick("E1", "fa", 2, "a2");
    expect(await newest("E1")).toEqual([await tickRow("E1", "fa", "a2")]);
    await tick("E1", "fa", 9, "a9");
    expect(await newest("E1")).toEqual([await tickRow("E1", "fa", "a2")]);
    await tick("E1", "fb", 7, "b7");
    expect(await newest("E1")).toEqual([await tickRow("E1", "fa", "a2"), await tickRow("E1", "fb", "b7")]);
  });

  it("a tick written straight into a day partition made after 0354 fires the trigger", async () => {
    const day = (
      await t.pool.query<{ part: string; at: string }>(
        `select 'public.charging_point_status_' || to_char(d, 'YYYYMMDD') as part, (d + interval '6 hours')::text as at
           from (select (now() at time zone 'UTC')::date + 38 as d) x`,
      )
    ).rows[0];
    const made = await t.pool.query("select 1 from pg_inherits where inhrelid = $1::regclass and inhparent = 'public.charging_point_status'::regclass", [day?.part]);
    expect(made.rowCount).toBe(1);
    await tick("E2", "fa", 0, "p0", { into: day?.part ?? "", when: day?.at ?? "" });
    expect(await newest("E2")).toEqual([await tickRow("E2", "fa", "p0")]);
  });

  it("an update of the held tick restates the row; a delete of it takes the newest tick left, none left no row", async () => {
    await tick("E3", "fa", 6, "c6");
    await tick("E3", "fa", 3, "c3");
    await t.pool.query("update charging_point_status set status = 'c3u', confidentiality = 'c3u-conf', source_run_id = 9001 where evse_id = 'E3' and status = 'c3'");
    expect(await newest("E3")).toEqual([await tickRow("E3", "fa", "c3u")]);
    await t.pool.query(`update charging_point_status set observed_at = ${at(1)} where evse_id = 'E3' and status = 'c6'`);
    expect(await newest("E3")).toEqual([await tickRow("E3", "fa", "c6")]);
    await t.pool.query("delete from charging_point_status where evse_id = 'E3' and status = 'c6'");
    expect(await newest("E3")).toEqual([await tickRow("E3", "fa", "c3u")]);
    await t.pool.query("delete from charging_point_status where evse_id = 'E3'");
    expect(await newest("E3")).toEqual([]);
  });

  it("an update of another tick to an instant older than the held one leaves the held row as it is", async () => {
    await tick("E8", "fa", 2, "h2");
    await tick("E8", "fa", 6, "h6");
    const held = await tickRow("E8", "fa", "h2");
    await t.pool.query(`update charging_point_status set observed_at = ${at(4)}, status = 'h4' where evse_id = 'E8' and status = 'h6'`);
    expect(await newest("E8")).toEqual([held]);
  });

  it("a day partition retired whole (detached, dropped) leaves the point's row", async () => {
    const r = (
      await t.pool.query<{ at: string; p: string }>(
        "select (d + interval '1 hour')::text as at, 'charging_point_status_' || to_char(d, 'YYYYMMDD') as p from (select (now() at time zone 'UTC')::date + 39 as d) x",
      )
    ).rows[0];
    await tick("E4", "fa", 0, "r0", { when: r?.at ?? "" });
    const before = await newest("E4");
    expect(before).toEqual([await tickRow("E4", "fa", "r0")]);
    await t.pool.query(`alter table public.charging_point_status detach partition public.${r?.p ?? ""}`);
    await t.pool.query(`drop table public.${r?.p ?? ""}`);
    expect(await newest("E4")).toEqual(before);
  });

  it("no tick without an EVSE id exists: the tick table and the newest table both refuse one", async () => {
    await expect(tick(null as unknown as string, "fa", 1, "n1")).rejects.toMatchObject({ code: "23502" });
    await expect(
      t.pool.query("insert into charging_point_status_newest (evse_id, observed_at, source_feed) values (null, now(), 'fa')"),
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("0354 and 0355 applied again from their rollbacks fill the newest tick of each point and feed, every column of it", async () => {
    await tick("E5", "fa", 8, "f8");
    await tick("E5", "fa", 4, "f4");
    await tick("E5", "fb", 10, "g10");
    for (const s of [...rollback("0355_charging_point_status_newest_triggers.sql"), ...rollback("0354_charging_point_status_newest.sql")]) await t.pool.query(s);
    expect((await t.pool.query("select to_regclass('public.charging_point_status_newest') as r")).rows[0]).toEqual({ r: null });
    await migrate(["0354_charging_point_status_newest.sql", "0355_charging_point_status_newest_triggers.sql"]);
    expect(await newest("E5")).toEqual([await tickRow("E5", "fa", "f4"), await tickRow("E5", "fb", "g10")]);
    expect(await newest("E1")).toEqual([await tickRow("E1", "fa", "a2"), await tickRow("E1", "fb", "b7")]);
  });

  it("0355's catch-up takes the ticks written between the files: newer wins over an older row, an equal or newer row is kept, a tick past the margin is left", async () => {
    await tick("K3", "fa", 2, "k3-held");
    await tick("K4", "fa", 0, "k4-held");
    await t.pool.query("update charging_point_status_newest set status = 'k4-equal' where evse_id = 'K4'");
    await tick("K5", "fa", 0, "k5-tick");
    await t.pool.query("update charging_point_status_newest set observed_at = observed_at + interval '2 hours', status = 'k5-newer' where evse_id = 'K5'");
    const k4 = await newest("K4");
    const k5 = await newest("K5");
    for (const s of rollback("0355_charging_point_status_newest_triggers.sql")) await t.pool.query(s);
    // written while no trigger is there: the gap between 0354's fill and 0355
    await tick("K1", "fa", 0, "k1");
    await tick("K2", "fa", 3, "k2");
    await tick("K3", "fa", 0, "k3-new");
    await t.pool.query("delete from charging_point_status where evse_id = 'K4' and status = 'k4-held'");
    await tick("K4", "fa", 0, "k4-same");
    expect(await newest("K1")).toEqual([]);
    await migrate(["0355_charging_point_status_newest_triggers.sql"]);
    expect(await newest("K1")).toEqual([await tickRow("K1", "fa", "k1")]);
    expect(await newest("K2")).toEqual([]);
    expect(await newest("K3")).toEqual([await tickRow("K3", "fa", "k3-new")]);
    expect(await newest("K4")).toEqual(k4);
    expect(await newest("K5")).toEqual(k5);
    // and the triggers are back
    await tick("K2", "fa", 1, "k2-after");
    expect(await newest("K2")).toEqual([await tickRow("K2", "fa", "k2-after")]);
  });

  it("api_reader and viafrei_mcp read the table; viafrei_digest reads the view and not the table; the table has fillfactor 80", async () => {
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
    const o = await t.pool.query<{ o: string[] }>("select reloptions as o from pg_class where oid = 'public.charging_point_status_newest'::regclass");
    expect(o.rows[0]?.o).toEqual(["fillfactor=80"]);
  });
});
