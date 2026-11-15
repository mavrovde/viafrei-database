/**
 * The status console's loaders, by behaviour (#32): growth_weekly_refresh
 * builds the Berlin weeks from Search Console, the site days and the MCP hours;
 * ops_rollup_refresh buckets the run ledgers into five minutes and Berlin days,
 * keeps its partitions and retention; ops_rollup_usage_fold folds the hourly
 * MCP tool calls into Berlin days per tool and traffic class; and
 * search_console_weekly_load stores one Search Console week, never letting an
 * unread week overwrite a read one.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb } from "./domain-db.js";
import { one, refused, requireDb, rows, url } from "./schema-db.js";

requireDb("the rollup loaders");

describe.skipIf(url === undefined)("the rollup loaders", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "rollup_ld");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  it("growth_weekly_refresh: each asked Berlin week from Search Console, the site days and the MCP hours, read only where the source covers the week; a refresh replaces; older than 104 weeks is deleted; a week count outside 1..105 is refused", async () => {
    await t.planted(async (c) => {
      const { w0 } = await one<{ w0: string }>(c, "select to_char(d - (extract(isodow from d)::integer - 1), 'YYYY-MM-DD') as w0 from (select (now() at time zone 'Europe/Berlin')::date as d) x");
      const w1 = `(date '${w0}' - 7)`;
      const W0 = `date '${w0}'`;
      const hour = (week: string, h: number): string => `date_trunc('hour', (${week}::timestamp + interval '${String(h)} hours') at time zone 'Europe/Berlin')`;
      await c.query(`insert into search_console_weekly (week, state, impressions, clicks, position) values (${w1}, 'read', 100, 5, 3.5), (${W0}, 'unread', null, null, null)`);
      // last week: seven labelled days; this week: one day with no labels
      await c.query(`insert into site_visits_daily (day, visitors, page_views, complete, automated, own_views, crawler_views)
                     select ${w1} + i, 1, 10, true, 4, 2, 1 from generate_series(0, 6) i`);
      await c.query(`insert into site_visits_daily (day, visitors, page_views, complete, automated) values (${W0}, 1, 6, false, null)`);
      await c.query(`insert into site_visits_daily (day, visitors, page_views, complete, automated, own_views, crawler_views) values (${w1} - 1, 1, 50, true, 0, 0, 0)`);
      await c.query(`insert into site_visits_routes (day, route, lang, views) values
                       (${w1}, '/', 'auto', 3), (${w1} + 1, '/de', 'de', 2), (${w1} + 6, '/en/connect', 'en', 4), (${w1}, '/de/x', 'de', 9),
                       (${w1}, '/deu', 'de', 9), (${w1} - 1, '/', 'auto', 50), (${W0}, '/de/connect', 'de', 1)`);
      const usage = (at: string, rpc: string, client: string, cols: Record<string, number>, period = "hour"): Promise<pg.QueryResult> =>
        c.query(`insert into mcp_usage (period, period_start, door, rpc, client, ${Object.keys(cols).join(", ")}) values ('${period}', ${at}, 'streamable', '${rpc}', '${client}', ${Object.values(cols).join(", ")})`);
      await usage(hour(w1, -1), "tools/call", "claude-ai", { requests: 500 });
      await usage(hour(w1, 0), "initialize", "claude-ai", { requests: 2, sessions: 2 });
      await usage(hour(w1, 1), "initialize", "chatgpt", { requests: 1, sessions: 0 });
      await usage(hour(w1, 2), "initialize", "unknown", { requests: 1, sessions: 1 });
      await usage(hour(w1, 3), "tools/call", "claude-ai", { requests: 10, tool_errors: 3, tool_error_invalid_input: 1, server_errors: 1 });
      await usage(hour(w1, 4), "tools/call", "viafrei-smoke", { requests: 4 });
      await usage(hour(w1, 5), "tools/call", "unknown", { requests: 7 });
      await usage(hour(w1, 167), "tools/call", "chatgpt", { requests: 1 });
      await usage(`(${w1}::timestamp at time zone 'UTC')`, "tools/call", "claude-ai", { requests: 900 }, "day");
      await usage(hour(W0, 1), "tools/call", "claude-ai", { requests: 6 });
      await c.query(`insert into growth_weekly (week, complete, search_state, site_state, site_days, mcp_state) values
                       (${W0} - 7 * 105, true, 'unread', 'unread', 0, 'unread'), (${W0} - 7 * 104, true, 'unread', 'unread', 0, 'unread')`);
      await c.query(`insert into search_console_weekly (week, state) values (${W0} - 7 * 105, 'unread'), (${W0} - 7 * 104, 'unread')`);
      const cols = `to_char(week, 'YYYY-MM-DD') as week, complete, search_state, search_impressions::int, search_clicks::int, search_position::text,
                    site_state, site_days, people_views, own_views, crawler_views, automation_views, home_views, connect_views,
                    mcp_state, mcp_initialize_ext, mcp_calls_ext, mcp_errors_ext, mcp_clients_ext, mcp_calls_own, directory_listings`;
      const weeks = (): Promise<unknown[]> => rows(c, `select ${cols} from growth_weekly where week >= ${w1} order by week`);
      expect((await one<{ n: number }>(c, "select growth_weekly_refresh(2) as n")).n).toBe(2);
      const wk1 = (await one<{ w: string }>(c, `select to_char(${w1}, 'YYYY-MM-DD') as w`)).w;
      const last = {
        week: wk1, complete: true, search_state: "read", search_impressions: 100, search_clicks: 5, search_position: "3.50",
        site_state: "read", site_days: 7, people_views: 56, own_views: 14, crawler_views: 7, automation_views: 21, home_views: 5, connect_views: 4,
        mcp_state: "read", mcp_initialize_ext: 2, mcp_calls_ext: 11, mcp_errors_ext: 3, mcp_clients_ext: 1, mcp_calls_own: 4, directory_listings: null,
      };
      const now0 = {
        week: w0, complete: false, search_state: "unread", search_impressions: null, search_clicks: null, search_position: null,
        site_state: "partial", site_days: 1, people_views: 6, own_views: null, crawler_views: null, automation_views: 0, home_views: 0, connect_views: 1,
        mcp_state: "read", mcp_initialize_ext: 0, mcp_calls_ext: 6, mcp_errors_ext: 0, mcp_clients_ext: 0, mcp_calls_own: 0, directory_listings: null,
      };
      expect(await weeks()).toEqual([last, now0]);
      expect(await rows(c, `select (week - ${W0}) / 7 as w from growth_weekly where week < ${w1} order by week`)).toEqual([{ w: -104 }]);
      expect(await rows(c, `select (week - ${W0}) / 7 as w from search_console_weekly where week < ${w1} order by week`)).toEqual([{ w: -104 }]);
      // the MCP hours start inside last week: that week is unread, this week still read; no site day this week is unread
      await c.query(`delete from mcp_usage where period_start <= ${hour(w1, 0)}`);
      await c.query(`delete from site_visits_daily where day = ${W0}`);
      expect((await one<{ n: number }>(c, "select growth_weekly_refresh(2) as n")).n).toBe(2);
      expect(await weeks()).toEqual([
        { ...last, mcp_state: "unread", mcp_initialize_ext: null, mcp_calls_ext: null, mcp_errors_ext: null, mcp_clients_ext: null, mcp_calls_own: null },
        { ...now0, site_state: "unread", site_days: 0, people_views: null, automation_views: null, home_views: null, connect_views: null },
      ]);
      expect((await one<{ n: number }>(c, "select growth_weekly_refresh(1) as n")).n).toBe(1);
      for (const bad of ["0", "106", "null"]) expect((await refused(c, `select growth_weekly_refresh(${bad})`))?.message).toMatch(/p_weeks must be 1\.\.105/);
      expect((await one<{ n: number }>(c, "select growth_weekly_refresh(105) as n")).n).toBe(105);
    });
  });

  it("ops_rollup_refresh: the runs of the window in five-minute buckets per ledger and key, their Berlin days, the usage and the held rows; the window's partitions made and the 90-day-old ones dropped; a refresh replaces; an empty or over-long window is refused", async () => {
    await t.planted(async (c) => {
      // B: yesterday's Berlin noon, so the window's buckets share a Berlin day; the window starts inside B's bucket and is binned down to it
      const { b } = await one<{ b: string }>(c, "select ((((now() at time zone 'Europe/Berlin')::date - 1) + time '12:00') at time zone 'Europe/Berlin')::text as b");
      const B = `timestamptz '${b}'`;
      const at = (min: number): string => `${B} + interval '${String(min)} minutes'`;
      const feed = (key: string, min: number, status: string, extra = ""): Promise<pg.QueryResult> =>
        c.query(`insert into feed_runs (feed_key, started_at, finished_at, status, items_seen, items_inserted, items_updated, items_closed, duration_ms${extra ? ", note" : ""})
                 values ('${key}', ${at(min)}, ${at(min)} + interval '2 seconds', '${status}', 5, 1, 2, 3, 400${extra ? `, '${extra}'` : ""})`);
      await feed("fa", 0, "ok");
      await feed("fa", 1, "error");
      await feed("fa", 2, "pending");
      await feed("fa", 3, "skipped");
      await feed("fa", 4, "held");
      await feed("fa", 6, "unchanged");
      await feed("fa", 7, "degraded");
      await feed("fa", -1, "ok");
      await feed("fa", 70, "ok");
      await feed("bad key", 0, "ok");
      await c.query(`insert into ingest_runs (provider, started_at, finished_at, status, rows, duration_ms) values
                       ('pi', ${at(0)}, ${at(0)} + interval '3 seconds', 'ok', 4, null),
                       ('pi', ${at(1)}, ${at(1)} + interval '1 second', 'degraded', 2, 250),
                       ('pi', ${at(2)}, null, 'running', null, null),
                       ('pi', ${at(3)}, ${at(3)}, 'interrupted', null, null),
                       ('pi', ${at(4)}, ${at(4)} + interval '1 second', 'error', null, 100),
                       ('pi', ${at(-1)}, ${at(-1)}, 'ok', 9, 9),
                       ('pi', ${at(10)}, ${at(10)}, 'ok', 9, 9)`);
      // a partition 91 UTC days old is dropped, one 89 days old kept
      const { d91, d89 } = await one<{ d91: string; d89: string }>(c, "select to_char((now() at time zone 'UTC')::date - 91, 'YYYYMMDD') as d91, to_char((now() at time zone 'UTC')::date - 89, 'YYYYMMDD') as d89");
      for (const d of [d91, d89]) await c.query(`create table ops_rollup_feed_${d} partition of ops_rollup_feed for values in ('${d}')`);
      await c.query(`insert into mcp_usage (period, period_start, door, rpc, tool, client, requests) values ('hour', date_trunc('hour', ${B}), 'streamable', 'tools/call', 'find_fuel', 'claude-ai', 1)`);
      const today = "(now() at time zone 'Europe/Berlin')::date";
      for (const tb of ["ops_rollup_daily", "ops_rollup_usage", "ops_rollup_held"]) {
        const vals = tb === "ops_rollup_daily" ? "'feed', 'old', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0" : tb === "ops_rollup_usage" ? "'old_tool', 'real', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0" : "'old_kind', 0";
        const names = tb === "ops_rollup_daily" ? "day, ledger, key, runs, ok, unchanged, degraded, error, quiet, items_seen, items_inserted, items_updated, items_closed, buckets_with_runs, buckets_with_success"
          : tb === "ops_rollup_usage" ? "day, tool, class, calls, errors, ms_le_100, ms_le_250, ms_le_500, ms_le_1000, ms_le_2500, ms_le_5000, ms_le_10000, ms_gt_10000" : "day, kind, approx_rows";
        await c.query(`insert into ${tb} (${names}) values (${today} - 401, ${vals}), (${today} - 399, ${vals})`);
      }
      const { days } = await one<{ days: number }>(c, `select count(*)::int as days from generate_series((${B} at time zone 'UTC')::date, ((${at(10)}) at time zone 'UTC')::date, interval '1 day') g where to_regclass('ops_rollup_feed_' || to_char(g, 'YYYYMMDD')) is null`);
      const refresh = (): Promise<Record<string, number>> => one(c, `select * from ops_rollup_refresh(${at(2)}, ${at(10)})`);
      const r1 = await refresh();
      expect(r1).toEqual({ bucket_rows: 3, daily_rows: 2, usage_rows: 1, held_rows: 8, partitions_created: days, partitions_dropped: 1 });
      const buckets = (): Promise<unknown[]> =>
        rows(c, `select ledger, key, extract(epoch from bucket_start - ${B})::int / 60 as min, runs, ok, unchanged, degraded, error, quiet, running,
                        items_seen::int, items_inserted::int, items_updated::int, items_closed::int, duration_ms_sum::int, duration_n,
                        extract(epoch from last_started_at - ${B})::int / 60 as last, last_status, extract(epoch from last_success_at - ${B})::int / 60 as suc,
                        bucket_day = (bucket_start at time zone 'UTC')::date as day_ok
                   from ops_rollup_feed order by ledger, key, bucket_start`);
      const z = { ok: 0, unchanged: 0, degraded: 0, error: 0, quiet: 0, running: 0, items_inserted: 0, items_updated: 0, items_closed: 0, day_ok: true };
      const fa0 = { ...z, ledger: "feed", key: "fa", min: 0, runs: 5, ok: 1, error: 1, quiet: 3, items_seen: 25, items_inserted: 5, items_updated: 10, items_closed: 15, duration_ms_sum: 2000, duration_n: 5, last: 4, last_status: "held", suc: 0 };
      const fa5 = { ...z, ledger: "feed", key: "fa", min: 5, runs: 2, unchanged: 1, degraded: 1, items_seen: 10, items_inserted: 2, items_updated: 4, items_closed: 6, duration_ms_sum: 800, duration_n: 2, last: 7, last_status: "degraded", suc: 7 };
      const pi0 = { ...z, ledger: "ingest", key: "pi", min: 0, runs: 5, ok: 1, degraded: 1, error: 1, quiet: 1, running: 1, items_seen: 6, duration_ms_sum: 3350, duration_n: 4, last: 4, last_status: "error", suc: 1 };
      expect(await buckets()).toEqual([fa0, fa5, pi0]);
      const { fresh } = await one<{ fresh: number }>(c, `select count(*)::int as fresh from ops_rollup_feed where ledger = 'feed' and key = 'fa' and bucket_start = ${B} - interval '5 minutes'`);
      expect(fresh).toBe(0);
      const daily = (): Promise<unknown[]> =>
        rows(c, `select ledger, key, day = (${B} at time zone 'Europe/Berlin')::date as day_ok, runs, ok, unchanged, degraded, error, quiet, items_seen::int, items_closed::int, buckets_with_runs, buckets_with_success,
                        extract(epoch from last_success_at - ${B})::int / 60 as suc
                   from ops_rollup_daily where key <> 'old' order by ledger, key`);
      expect(await daily()).toEqual([
        { ledger: "feed", key: "fa", day_ok: true, runs: 7, ok: 1, unchanged: 1, degraded: 1, error: 1, quiet: 3, items_seen: 35, items_closed: 21, buckets_with_runs: 2, buckets_with_success: 2, suc: 7 },
        { ledger: "ingest", key: "pi", day_ok: true, runs: 5, ok: 1, unchanged: 0, degraded: 1, error: 1, quiet: 1, items_seen: 6, items_closed: 0, buckets_with_runs: 1, buckets_with_success: 1, suc: 1 },
      ]);
      expect(await rows(c, `select kind from ops_rollup_held where day = ${today} order by kind`)).toEqual(
        ["charging_points", "fuel_stations", "parking_facilities", "places", "road_messages", "scheduled_stop_times", "stops", "weather_warnings"].map((kind) => ({ kind })),
      );
      for (const tb of ["ops_rollup_daily", "ops_rollup_usage", "ops_rollup_held"]) expect([tb, await rows(c, `select ${today} - day as age from ${tb} where day < ${today} - 300`)]).toEqual([tb, [{ age: 399 }]]);
      expect(await one(c, `select to_regclass('ops_rollup_feed_${d91}') is null as gone, to_regclass('ops_rollup_feed_${d89}') is not null as kept`)).toEqual({ gone: true, kept: true });
      // a refresh replaces: a run deleted is gone from its bucket, nothing is added twice
      await c.query(`delete from feed_runs where feed_key = 'fa' and started_at = ${at(1)}`);
      const r2 = await refresh();
      expect(r2).toMatchObject({ bucket_rows: 3, daily_rows: 2, usage_rows: 1, partitions_created: 0, partitions_dropped: 0 });
      expect(await buckets()).toEqual([{ ...fa0, runs: 4, error: 0, items_seen: 20, items_inserted: 4, items_updated: 8, items_closed: 12, duration_ms_sum: 1600, duration_n: 4 }, fa5, pi0]);
      expect((await daily())[0]).toMatchObject({ runs: 6, error: 0 });
      for (const w of [`${at(5)}, ${at(5)}`, `${at(5)}, ${at(4)}`, `null, ${at(4)}`, `${at(4)}, null`]) expect((await refused(c, `select * from ops_rollup_refresh(${w})`))?.message).toMatch(/window must be non-empty/);
      expect((await refused(c, `select * from ops_rollup_refresh(${at(0)} - interval '8 days 1 second', ${at(0)})`))?.message).toMatch(/longer than 8 days/);
      expect(await one(c, `select bucket_rows from ops_rollup_refresh(${at(10)} - interval '8 days', ${at(10)})`)).toEqual({ bucket_rows: 5 });
    });
  });

  it("ops_rollup_usage_fold: the hourly tool calls of the Berlin days asked, per tool (else other) and class, errors without the caller's own; a refold replaces; no range is refused", async () => {
    await t.planted(async (c) => {
      const usage = (at: string, tool: string, client: string, extra: Record<string, string | number> = {}, period = "hour", rpc = "tools/call"): Promise<pg.QueryResult> => {
        const cols = { period: `'${period}'`, period_start: `'${at}'`, door: "'streamable'", rpc: `'${rpc}'`, tool: `'${tool}'`, client: `'${client}'`, requests: 1, ...extra };
        return c.query(`insert into mcp_usage (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")})`);
      };
      // 2026-11-14 in Berlin (CET) is [13 23:00Z, 14 23:00Z)
      await usage("2026-11-13T23:00Z", "find_fuel", "claude-ai", { requests: 10, tool_errors: 5, tool_error_invalid_input: 2, tool_error_not_found: 1, tool_error_out_of_coverage: 1, server_errors: 2, ms_le_100: 7, ms_gt_10000: 3 });
      await usage("2026-11-14T22:00Z", "find_fuel", "chatgpt", { requests: 5, tool_errors: 1, tool_error_invalid_input: 3, ms_le_100: 1 });
      await usage("2026-11-14T12:00Z", "", "viafrei-smoke", { requests: 2 });
      await usage("2026-11-14T12:00Z", "find_fuel", "unknown", { requests: 4, server_errors: 1 });
      await usage("2026-11-14T23:00Z", "find_fuel", "claude-ai", { requests: 100 });
      await usage("2026-11-13T22:00Z", "find_fuel", "claude-ai", { requests: 100 });
      await usage("2026-11-14T12:00Z", "find_fuel", "claude-ai", { requests: 100 }, "hour", "tools/list");
      await usage("2026-11-14T00:00Z", "find_fuel", "claude-ai", { requests: 100 }, "day");
      const folded = async (): Promise<string[]> =>
        (await rows<{ x: string }>(c, "select day || ' ' || tool || ' ' || class || ' ' || calls || ' ' || errors || ' ' || ms_le_100 || ' ' || ms_gt_10000 as x from ops_rollup_usage")).map((x) => x.x).sort();
      expect((await one<{ n: number }>(c, "select ops_rollup_usage_fold('2026-11-14', '2026-11-14') as n")).n).toBe(3);
      expect(await folded()).toEqual(["2026-11-14 find_fuel real 15 3 8 3", "2026-11-14 find_fuel scanners 4 1 0 0", "2026-11-14 other own 2 0 0 0"]);
      await c.query("update mcp_usage set requests = 20 where client = 'claude-ai' and period_start = '2026-11-13T23:00Z'");
      expect((await one<{ n: number }>(c, "select ops_rollup_usage_fold('2026-11-14', '2026-11-14') as n")).n).toBe(3);
      expect(await folded()).toContain("2026-11-14 find_fuel real 25 3 8 3");
      expect((await one<{ n: number }>(c, "select ops_rollup_usage_fold('2026-11-13', '2026-11-15') as n")).n).toBe(5);
      expect((await refused(c, "select ops_rollup_usage_fold('2026-11-15', '2026-11-14')"))?.message).toMatch(/non-empty range/);
      expect((await refused(c, "select ops_rollup_usage_fold(null, '2026-11-14')"))?.message).toMatch(/non-empty range/);
    });
  });

  it("search_console_weekly_load: a read week replaces the week and its parts; an unread one is stored but never over a read one, which only notes the try; no week or state is refused", async () => {
    await t.planted(async (c) => {
      const load = async (doc: unknown): Promise<string> => (await one<{ r: string }>(c, "select search_console_weekly_load($1::jsonb) as r", [JSON.stringify(doc)])).r;
      const week = async (w: string): Promise<unknown> =>
        one(c, "select state, impressions::int, clicks::int, position::text, shown_not_clicked, legacy_impressions::int, tried_at < now() - interval '1 day' as tried_long_ago from search_console_weekly where week = $1", [w]);
      const parts = async (w: string): Promise<string[]> =>
        (await rows<{ x: string }>(c, "select dimension || ':' || key || ' ' || coalesce(rows::text, '-') || ' ' || impressions || ' ' || clicks || ' ' || position as x from search_console_weekly_parts where week = $1", [w])).map((x) => x.x).sort();
      const read = {
        week: "2026-11-09",
        state: "read",
        impressions: 900,
        clicks: 30,
        position: 7.25,
        shownNotClicked: 12,
        legacyImpressions: 1000,
        parts: [
          { dimension: "device", key: "mobile", impressions: 600, clicks: 20, position: 6.5 },
          { dimension: "position_bucket", key: "1-3", rows: 4, impressions: 100, clicks: 10, position: 2 },
        ],
      };
      expect(await load(read)).toBe("read parts=2");
      expect(await week("2026-11-09")).toEqual({ state: "read", impressions: 900, clicks: 30, position: "7.25", shown_not_clicked: 12, legacy_impressions: 1000, tried_long_ago: false });
      expect(await parts("2026-11-09")).toEqual(["device:mobile - 600 20 6.50", "position_bucket:1-3 4 100 10 2.00"]);
      await c.query("update search_console_weekly set tried_at = now() - interval '2 days'");
      expect(await load({ week: "2026-11-09", state: "unread" })).toBe("unread parts=0 kept=read");
      expect(await week("2026-11-09")).toMatchObject({ state: "read", impressions: 900, tried_long_ago: false });
      expect(await parts("2026-11-09")).toHaveLength(2);
      expect(await load({ ...read, impressions: 950, parts: [{ dimension: "page_type", key: "road", impressions: 50, clicks: 5, position: 3 }] })).toBe("read parts=1");
      expect(await parts("2026-11-09")).toEqual(["page_type:road - 50 5 3.00"]);
      expect(await week("2026-11-09")).toMatchObject({ impressions: 950 });
      expect(await load({ week: "2026-11-02", state: "unread", parts: read.parts })).toBe("unread parts=0");
      expect(await week("2026-11-02")).toEqual({ state: "unread", impressions: null, clicks: null, position: null, shown_not_clicked: null, legacy_impressions: null, tried_long_ago: false });
      expect(await parts("2026-11-02")).toEqual([]);
      expect(await load({ week: "2026-11-02", state: "unread" })).toBe("unread parts=0");
      expect((await refused(c, "select search_console_weekly_load('{\"state\": \"read\"}')"))?.message).toMatch(/needs week and state/);
      expect((await refused(c, "select search_console_weekly_load('{\"week\": \"2026-11-09\"}')"))?.message).toMatch(/needs week and state/);
    });
  });
});
