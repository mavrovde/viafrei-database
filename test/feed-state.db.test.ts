/**
 * The run ledgers and what the database derives from them: control.feed_state
 * (the statement triggers on feed_runs and ingest_runs, fold_feed_state and
 * recompute_feed_state), feed_versions and feed_run_extents (feed_versions_bump
 * and feed_versions_forget), the readers control.data_status, feed_checks and
 * registered_sources, the ingestor's register_feed / taken_feed_keys /
 * project_run, and runtime_config's source bounds. Every test runs as the
 * owner in a transaction that is rolled back.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb } from "./domain-db.js";
import { one, refused, requireDb, rows, url } from "./schema-db.js";

requireDb("the run ledgers");

const TERMS = {
  callers: [{ caller: "wk", process: "worker", person: false, purpose: "the background worker" }],
  budgets: [{ budget_key: "plain", window_s: 3600, licence_max: 10, licence_source: "test terms", hold_s: 300 }],
  providers: [{ provider: "p_plain", budget_key: "plain", min_interval_ms: 1, max_concurrent: 1 }],
};

const T0 = Date.parse("2026-01-01T00:00:00Z");
const at = (min: number): string => new Date(T0 + min * 60_000).toISOString();

type FeedRun = { key: string; min: number | null; status: string; hit?: string | null; seen?: number | null; ins?: number | null; due?: number | null };
type IngestRun = { key: string; min: number | null; status: string; hit?: string | null; rows?: number | null };

const insertFeed = (c: pg.ClientBase, runs: readonly FeedRun[]): Promise<pg.QueryResult> =>
  c.query(
    `insert into feed_runs (feed_key, started_at, finished_at, status, budget_hit, items_seen, items_inserted, next_due_at)
     select r.key, coalesce(r.fin, $2::timestamptz) - interval '10 seconds', r.fin, r.status, r.hit, r.seen, r.ins, r.due
       from jsonb_to_recordset($1::jsonb) r(key text, fin timestamptz, status text, hit text, seen int, ins int, due timestamptz)`,
    [JSON.stringify(runs.map((r) => ({ key: r.key, fin: r.min === null ? null : at(r.min), status: r.status, hit: r.hit ?? null, seen: r.seen ?? null, ins: r.ins ?? null, due: r.due == null ? null : at(r.due) }))), at(0)],
  );
const insertIngest = (c: pg.ClientBase, runs: readonly IngestRun[]): Promise<pg.QueryResult> =>
  c.query(
    `insert into ingest_runs (provider, started_at, finished_at, status, budget_hit, rows)
     select r.key, coalesce(r.fin, $2::timestamptz) - interval '10 seconds', r.fin, r.status, r.hit, r.rows
       from jsonb_to_recordset($1::jsonb) r(key text, fin timestamptz, status text, hit text, rows int)`,
    [JSON.stringify(runs.map((r) => ({ key: r.key, fin: r.min === null ? null : at(r.min), status: r.status, hit: r.hit ?? null, rows: r.rows ?? null }))), at(0)],
  );

type State = { key: string; budget_key: string | null; cadence_s: number | null; att: string | null; status: string | null; suc: string | null; chg: string | null; ref: string | null; hit: string | null; since: string | null; due: string | null };
const iso = (col: string): string => `to_char((${col}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')`;
const state = (c: pg.ClientBase, ledger: string): Promise<State[]> =>
  rows<State>(
    c,
    `select key, budget_key, cadence_s, ${iso("last_attempt_at")} as att, last_attempt_status as status, ${iso("last_success_at")} as suc,
            ${iso("last_changed_at")} as chg, ${iso("last_refusal_at")} as ref, last_refusal as hit, ${iso("refused_since")} as since, ${iso("next_due_at")} as due
       from control.feed_state where ledger = $1 order by key`,
    [ledger],
  );
const m = (min: number | null): string | null => (min === null ? null : at(min).slice(0, 19));

/** A small seeded PRNG, so a failing history can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe.skipIf(url === undefined)("the run ledgers", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "ledgers");

  beforeAll(async () => {
    await t.make([
      ["src_one", "road_events", 50],
      ["src_two", "road_events", 50],
    ]);
    await t.pool.query("select * from control.publish_terms($1::jsonb)", [JSON.stringify(TERMS)]);
    await t.pool.query(
      `insert into feed_catalog (feed_key, provider, display_name, licence_id, cadence_s) values
         ('fa', 'p_plain', 'Feed A', 'CC-BY-4.0', 60), ('fb', 'p_plain', 'Feed B', 'CC-BY-4.0', 120), ('fc', 'nobody', 'Feed C', 'CC-BY-4.0', null)`,
    );
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  describe("control.feed_state from the feed ledger", () => {
    it("an attempt, a success and a change set their times; a budget refusal is no attempt and starts the pause; the next real run ends it", async () => {
      await t.planted(async (c) => {
        await insertFeed(c, [{ key: "fa", min: 1, status: "ok", seen: 5, ins: 2, due: 2 }]);
        expect(await state(c, "feed")).toEqual([{ key: "fa", budget_key: "plain", cadence_s: 60, att: m(1), status: "ok", suc: m(1), chg: m(1), ref: null, hit: null, since: null, due: m(2) }]);
        await insertFeed(c, [{ key: "fa", min: 2, status: "error", hit: "share" }]);
        await insertFeed(c, [{ key: "fa", min: 3, status: "error", hit: "ceiling" }]);
        expect(await state(c, "feed")).toEqual([{ key: "fa", budget_key: "plain", cadence_s: 60, att: m(1), status: "ok", suc: m(1), chg: m(1), ref: m(3), hit: "ceiling", since: m(2), due: m(2) }]);
        await insertFeed(c, [{ key: "fa", min: 4, status: "unchanged", seen: 5 }]);
        expect(await state(c, "feed")).toEqual([{ key: "fa", budget_key: "plain", cadence_s: 60, att: m(4), status: "unchanged", suc: m(4), chg: m(1), ref: m(3), hit: "ceiling", since: null, due: null }]);
      });
    });

    it("an error is an attempt and no success; a degraded run with no count is no success; running, pending and unfinished runs are not read", async () => {
      await t.planted(async (c) => {
        await insertFeed(c, [
          { key: "fb", min: 1, status: "ok", seen: 1 },
          { key: "fb", min: 2, status: "degraded" },
          { key: "fb", min: null, status: "pending" },
        ]);
        await insertFeed(c, [{ key: "fb", min: 3, status: "error" }]);
        // a held run is no attempt, success, change or refusal: no row
        await insertFeed(c, [{ key: "fc", min: 3, status: "held" }]);
        expect(await state(c, "feed")).toEqual([
          { key: "fb", budget_key: "plain", cadence_s: 120, att: m(3), status: "error", suc: m(1), chg: null, ref: null, hit: null, since: null, due: null },
        ]);
        await insertFeed(c, [{ key: "fb", min: 4, status: "degraded", seen: 3 }]);
        expect((await state(c, "feed"))[0]?.suc).toBe(m(4));
      });
    });

    it("feed_state is a function of the ledger: deleting the success moves the held time back; deleting every run removes the row; a delete of a run it does not hold recomputes nothing", async () => {
      await t.planted(async (c) => {
        await insertFeed(c, [
          { key: "fa", min: 1, status: "ok", ins: 1 },
          { key: "fa", min: 2, status: "error" },
          { key: "fa", min: 3, status: "ok" },
        ]);
        const before = await one<{ u: string }>(c, "select updated_at::text as u from control.feed_state where key = 'fa'");
        await c.query(`delete from feed_runs where feed_key = 'fa' and finished_at = $1`, [at(2)]);
        expect((await one<{ u: string }>(c, "select updated_at::text as u from control.feed_state where key = 'fa'")).u).toBe(before.u);
        await c.query(`delete from feed_runs where feed_key = 'fa' and finished_at = $1`, [at(3)]);
        expect(await state(c, "feed")).toEqual([{ key: "fa", budget_key: "plain", cadence_s: 60, att: m(1), status: "ok", suc: m(1), chg: m(1), ref: null, hit: null, since: null, due: null }]);
        await c.query("delete from feed_runs where feed_key = 'fa'");
        expect(await state(c, "feed")).toEqual([]);
      });
    });

    it("an update of a run the row holds recomputes that key; an update that changes nothing it reads leaves it", async () => {
      await t.planted(async (c) => {
        await insertFeed(c, [
          { key: "fa", min: 1, status: "ok" },
          { key: "fa", min: 2, status: "ok" },
        ]);
        await c.query("update feed_runs set note = 'a note' where feed_key = 'fa'");
        expect((await state(c, "feed"))[0]?.suc).toBe(m(2));
        await c.query("update feed_runs set status = 'error' where feed_key = 'fa' and finished_at = $1", [at(2)]);
        expect((await state(c, "feed"))[0]).toMatchObject({ att: m(2), status: "error", suc: m(1) });
        await c.query("update feed_runs set budget_hit = 'share' where feed_key = 'fa' and finished_at = $1", [at(2)]);
        expect((await state(c, "feed"))[0]).toMatchObject({ att: m(1), status: "ok", ref: m(2), hit: "share", since: m(2) });
      });
    });

    it("a truncate of one ledger forgets that ledger's rows only", async () => {
      await t.planted(async (c) => {
        await insertFeed(c, [{ key: "fa", min: 1, status: "ok" }]);
        await insertIngest(c, [{ key: "p_plain", min: 1, status: "ok" }]);
        await c.query("truncate feed_runs");
        expect(await state(c, "feed")).toEqual([]);
        expect((await state(c, "ingest")).map((x) => x.key)).toEqual(["p_plain"]);
        await c.query("truncate ingest_runs");
        expect(await state(c, "ingest")).toEqual([]);
      });
    });

    it("the fold equals the recompute: random histories of attempts, refusals, errors and changes, inserted out of order in batches", async () => {
      const statuses = ["ok", "unchanged", "degraded", "error", "held", "skipped", "pending"];
      const hits = ["share", "ceiling", "spacing", "unavailable"];
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const r = rng(seed);
        const runs: FeedRun[] = Array.from({ length: 40 }, (_, i) => {
          const status = statuses[Math.floor(r() * statuses.length)] ?? "ok";
          return {
            key: ["fa", "fb", "fc"][Math.floor(r() * 3)] ?? "fa",
            min: status === "pending" ? null : i + 1,
            status,
            hit: r() < 0.35 ? (hits[Math.floor(r() * hits.length)] ?? null) : null,
            seen: r() < 0.6 ? Math.floor(r() * 9) : null,
            ins: r() < 0.5 ? Math.floor(r() * 3) : null,
            due: r() < 0.5 ? i + 30 : null,
          };
        });
        const shuffled = [...runs].sort(() => r() - 0.5);
        await t.planted(async (c) => {
          for (let i = 0; i < shuffled.length; i += 7) await insertFeed(c, shuffled.slice(i, i + 7));
          const folded = await state(c, "feed");
          await c.query("select control.recompute_feed_state('feed', array['fa', 'fb', 'fc'])");
          expect([seed, folded]).toEqual([seed, await state(c, "feed")]);
        });
        // a running ingest row is unfinished, as the writer leaves it: running with a finished_at and rows is read differently by
        // the fold (skipped) and the recompute (a change) — reported, not pinned here
        const ingest: IngestRun[] = runs.map((x) => ({ key: x.key === "fa" ? "p_plain" : `p_plain:${x.key}`, min: x.status === "held" ? null : x.min, status: x.status === "unchanged" ? "interrupted" : x.status === "held" ? "running" : x.status === "pending" || x.status === "skipped" ? "ok" : x.status, hit: x.hit ?? null, rows: x.seen ?? null }));
        await t.planted(async (c) => {
          const sh = [...ingest].sort(() => r() - 0.5);
          for (let i = 0; i < sh.length; i += 9) await insertIngest(c, sh.slice(i, i + 9));
          const folded = await state(c, "ingest");
          await c.query("select control.recompute_feed_state('ingest', array['p_plain', 'p_plain:fb', 'p_plain:fc'])");
          expect([seed, folded]).toEqual([seed, await state(c, "ingest")]);
        });
      }
    });

    it("a change is any item inserted, updated or closed, each alone", async () => {
      await t.planted(async (c) => {
        await insertFeed(c, [{ key: "fa", min: 1, status: "ok", ins: 1 }]);
        await c.query("insert into feed_runs (feed_key, started_at, finished_at, status, items_updated) values ('fa', $1, $1, 'ok', 2)", [at(2)]);
        expect((await state(c, "feed"))[0]?.chg).toBe(m(2));
        await c.query("insert into feed_runs (feed_key, started_at, finished_at, status, items_closed) values ('fa', $1, $1, 'ok', 1)", [at(3)]);
        expect((await state(c, "feed"))[0]?.chg).toBe(m(3));
        await c.query("insert into feed_runs (feed_key, started_at, finished_at, status, items_inserted, items_updated, items_closed) values ('fa', $1, $1, 'ok', 0, 0, 0)", [at(4)]);
        expect((await state(c, "feed"))[0]).toMatchObject({ suc: m(4), chg: m(3) });
      });
    });

    it("a bulk insert over two keys folds each key to its newest run", async () => {
      await t.planted(async (c) => {
        await insertFeed(c, [
          { key: "fa", min: 3, status: "ok" },
          { key: "fb", min: 1, status: "ok" },
          { key: "fa", min: 1, status: "error" },
          { key: "fb", min: 4, status: "error" },
        ]);
        expect((await state(c, "feed")).map((x) => [x.key, x.att, x.status, x.suc])).toEqual([
          ["fa", m(3), "ok", m(3)],
          ["fb", m(4), "error", m(1)],
        ]);
      });
    });

    it("an attempt that lands between two known refusals: the pause starts at the first refusal after it", async () => {
      await t.planted(async (c) => {
        await insertFeed(c, [{ key: "fa", min: 1, status: "ok" }]);
        await insertFeed(c, [{ key: "fa", min: 2, status: "error", hit: "share" }]);
        await insertFeed(c, [{ key: "fa", min: 4, status: "error", hit: "share" }]);
        await insertFeed(c, [{ key: "fa", min: 3, status: "ok" }]);
        expect((await state(c, "feed"))[0]).toMatchObject({ att: m(3), ref: m(4), since: m(4) });
      });
    });
  });

  describe("control.feed_state from the ingest ledger", () => {
    it("a provider key's budget is its part before the colon; an interrupted run is an attempt and no success; rows make a change", async () => {
      await t.planted(async (c) => {
        await insertIngest(c, [
          { key: "p_plain:sub", min: 1, status: "ok", rows: 3 },
          { key: "p_plain:sub", min: 2, status: "interrupted" },
          { key: "other", min: 1, status: "degraded", rows: 0 },
          { key: "other", min: 2, status: "ok", hit: "hold" },
          { key: "other", min: null, status: "running" },
        ]);
        expect(await state(c, "ingest")).toEqual([
          { key: "other", budget_key: null, cadence_s: null, att: m(1), status: "degraded", suc: m(1), chg: null, ref: m(2), hit: "hold", since: m(2), due: null },
          { key: "p_plain:sub", budget_key: "plain", cadence_s: null, att: m(2), status: "interrupted", suc: m(1), chg: m(1), ref: null, hit: null, since: null, due: null },
        ]);
        await c.query("delete from ingest_runs where provider = 'p_plain:sub' and status = 'interrupted'");
        expect((await state(c, "ingest"))[1]).toMatchObject({ att: m(1), status: "ok" });
        await c.query("update ingest_runs set status = 'error' where provider = 'p_plain:sub'");
        // an error that wrote rows is still a change: the ingest ledger's change is its rows, whatever the status
        expect((await state(c, "ingest"))[1]).toMatchObject({ att: m(1), status: "error", suc: null, chg: m(1) });
        await c.query("update ingest_runs set rows = 0 where provider = 'p_plain:sub'");
        expect((await state(c, "ingest"))[1]).toMatchObject({ att: m(1), status: "error", suc: null, chg: null });
      });
    });

    it("every feed_state trigger fires always: session_replication_role = replica skips none", async () => {
      const r = await rows<{ x: string }>(t.pool, "select tgrelid::regclass || ' ' || tgname || ' ' || tgenabled::text as x from pg_trigger where not tgisinternal and tgname like '%feed_state%' order by 1");
      expect(r.map((x) => x.x)).toEqual([
        "feed_runs feed_runs_feed_state_delete A",
        "feed_runs feed_runs_feed_state_insert A",
        "feed_runs feed_runs_feed_state_truncate A",
        "feed_runs feed_runs_feed_state_update A",
        "ingest_runs ingest_runs_feed_state_delete A",
        "ingest_runs ingest_runs_feed_state_insert A",
        "ingest_runs ingest_runs_feed_state_truncate A",
        "ingest_runs ingest_runs_feed_state_update A",
      ]);
      await t.planted(async (c) => {
        await c.query("set local session_replication_role = replica");
        await insertIngest(c, [{ key: "p_plain", min: 1, status: "ok" }]);
        await insertFeed(c, [{ key: "fa", min: 1, status: "ok" }]);
        expect((await rows<{ k: string }>(c, "select ledger || ' ' || key as k from control.feed_state order by 1")).map((x) => x.k)).toEqual(["feed fa", "ingest p_plain"]);
      });
    });
  });

  describe("control.data_status and feed_checks", () => {
    type Status = { key: string; held_age_s: number | null; paused: boolean; pause_reason: string | null; budget_hit: string | null; paused_since: string | null; resumes_at: string | null; stale: boolean; cadence_s: number | null };
    const status = (c: pg.ClientBase, key: string): Promise<Status> =>
      one<Status>(
        c,
        `select key, held_age_s::int, paused, pause_reason, budget_hit, ${iso("paused_since")} as paused_since, ${iso("resumes_at")} as resumes_at, stale, cadence_s
           from control.data_status where ledger = 'feed' and key = $1`,
        [key],
      );
    const runAgo = (c: pg.ClientBase, key: string, secs: number, st: string, hit: string | null = null): Promise<pg.QueryResult> =>
      c.query("insert into feed_runs (feed_key, started_at, finished_at, status, budget_hit) values ($1, now() - make_interval(secs => $2 + 5), now() - make_interval(secs => $2), $3, $4)", [key, secs, st, hit]);

    it("a success older than three cadences is stale; the same age with a budget refusal after it is paused and never stale, with the hit, the pause's start and its resume", async () => {
      await t.planted(async (c) => {
        await runAgo(c, "fa", 240, "ok");
        const s1 = await status(c, "fa");
        expect(s1).toMatchObject({ paused: false, pause_reason: null, budget_hit: null, stale: true, cadence_s: 60 });
        expect(s1.held_age_s).toBeGreaterThanOrEqual(239);
        await runAgo(c, "fa", 170, "unchanged");
        expect((await status(c, "fa")).stale).toBe(false);
        await c.query("delete from feed_runs where feed_key = 'fa' and status = 'unchanged'");
        await runAgo(c, "fa", 100, "error", "share");
        await c.query("insert into control.refusals (at, budget_key, provider, caller, subject, outcome, wait_ms) values (now() - interval '100 seconds', 'plain', 'p_plain', 'wk', 'fa', 'share', 30000)");
        const since = (await one<{ s: string }>(c, `select ${iso("now() - interval '100 seconds'")} as s`)).s;
        const resumes = (await one<{ s: string }>(c, `select ${iso("now() - interval '70 seconds'")} as s`)).s;
        expect(await status(c, "fa")).toMatchObject({ paused: true, pause_reason: "budget", budget_hit: "share", stale: false, paused_since: since, resumes_at: resumes });
      });
    });

    it("a hold in force pauses the feed from the hold's start; the owner's pause, by the schedule or by runtime_config, comes first", async () => {
      await t.planted(async (c) => {
        await runAgo(c, "fa", 600, "ok");
        await c.query("update control.budget_state set held_until = now() + interval '100 seconds' where budget_key = 'plain'");
        const since = (await one<{ s: string }>(c, `select ${iso("now() + interval '100 seconds' - interval '300 seconds'")} as s`)).s;
        expect(await status(c, "fa")).toMatchObject({ paused: true, pause_reason: "hold", paused_since: since, stale: false });
        await c.query("insert into runtime_config (key, value, changed_by, reason, changed_at) values ('source.fa.paused', 'true', 'owner', 'paused by the test', now() - interval '1 hour')");
        expect(await status(c, "fa")).toMatchObject({ paused: true, pause_reason: "owner", paused_since: (await one<{ s: string }>(c, `select ${iso("now() - interval '1 hour'")} as s`)).s });
        await c.query(
          `insert into source_schedule (source_key, host, state, declared_cadence_s, granted_cadence_s, floor_s, paused_by, paused_at, paused_reason)
           values ('fa', 'ingest-dwd', 'paused', 60, 60, 60, 'owner', now() - interval '2 hours', 'paused by the test')`,
        );
        expect((await status(c, "fa")).paused_since).toBe((await one<{ s: string }>(c, `select ${iso("now() - interval '2 hours'")} as s`)).s);
        await c.query("update runtime_config set value = 'false' where key = 'source.fa.paused'");
        await c.query("update source_schedule set state = 'active' where source_key = 'fa'");
        await c.query("update control.budget_state set held_until = now() - interval '1 second' where budget_key = 'plain'");
        expect(await status(c, "fa")).toMatchObject({ paused: false, pause_reason: null, stale: true });
      });
    });

    it("feed_checks: one row per open catalogue feed, checked_at the held success, paused_at the pause, a feed with no state not paused", async () => {
      await t.planted(async (c) => {
        await c.query("insert into feed_catalog (feed_key, provider, display_name, licence_id, closed_at) values ('fz', 'p_plain', 'Closed', 'CC-BY-4.0', now())");
        await insertFeed(c, [{ key: "fa", min: 1, status: "ok" }]);
        await insertFeed(c, [{ key: "fa", min: 2, status: "error" }]);
        await insertFeed(c, [{ key: "fa", min: 3, status: "error", hit: "share" }]);
        const r = await rows<{ feed_key: string; cadence_s: number | null; checked_at: string | null; paused_at: string | null; paused: boolean }>(
          c,
          `select feed_key, cadence_s, ${iso("checked_at")} as checked_at, ${iso("paused_at")} as paused_at, paused from feed_checks order by 1`,
        );
        expect(r).toEqual([
          { feed_key: "fa", cadence_s: 60, checked_at: m(1), paused_at: m(3), paused: true },
          { feed_key: "fb", cadence_s: 120, checked_at: null, paused_at: null, paused: false },
          { feed_key: "fc", cadence_s: null, checked_at: null, paused_at: null, paused: false },
        ]);
      });
    });
  });

  describe("feed_versions and feed_run_extents", () => {
    const versions = async (c: pg.ClientBase): Promise<string[]> =>
      (await rows<{ x: string }>(c, `select ledger || ' ' || key || ' ' || version || ' ' || ${iso("observed_at")} as x from feed_versions order by 1`)).map((x) => x.x);
    const extent = (c: pg.ClientBase, key: string): Promise<{ max_items: number | null; version: number }> =>
      one<{ max_items: number | null; version: number }>(c, "select max_items, version::int from feed_run_extents where feed_key = $1", [key]);

    it("an ok or degraded run bumps the version; unchanged, error and unfinished runs do not; the observed time never moves back", async () => {
      await t.planted(async (c) => {
        await insertFeed(c, [{ key: "fa", min: 5, status: "ok", seen: 3 }]);
        await insertFeed(c, [{ key: "fa", min: 3, status: "degraded", seen: 1 }]);
        await insertFeed(c, [
          { key: "fa", min: 6, status: "unchanged", seen: 3 },
          { key: "fa", min: 7, status: "error" },
          { key: "fa", min: null, status: "pending" },
        ]);
        await insertIngest(c, [{ key: "p_plain", min: 2, status: "ok" }]);
        await insertIngest(c, [{ key: "p_plain", min: 4, status: "error" }]);
        expect(await versions(c)).toEqual([`feed fa 2 ${m(5) ?? ""}`, `ingest p_plain 1 ${m(2) ?? ""}`]);
      });
    });

    it("an update bumps only when the finish, the status or the count moved", async () => {
      await t.planted(async (c) => {
        await c.query("insert into feed_runs (feed_key, started_at, status) values ('fb', $1, 'pending')", [at(0)]);
        await c.query("update feed_runs set finished_at = $1, status = 'ok', items_seen = 2 where feed_key = 'fb'", [at(1)]);
        await c.query("update feed_runs set note = 'a note' where feed_key = 'fb'");
        expect(await versions(c)).toEqual([`feed fb 1 ${m(1) ?? ""}`]);
        await c.query("update feed_runs set items_seen = 4 where feed_key = 'fb'");
        expect(await versions(c)).toEqual([`feed fb 2 ${m(1) ?? ""}`]);
        await c.query("insert into ingest_runs (provider, started_at) values ('p_plain', $1)", [at(0)]);
        await c.query("update ingest_runs set finished_at = $1, status = 'ok' where provider = 'p_plain'", [at(1)]);
        await c.query("update ingest_runs set rows = 9 where provider = 'p_plain'");
        expect(await versions(c)).toContain(`ingest p_plain 1 ${m(1) ?? ""}`);
      });
    });

    it("the extent is the largest count of the 48 hours before the newest run, with the version beside it; a delete forgets the deleted run and bumps the version", async () => {
      await t.planted(async (c) => {
        await insertFeed(c, [{ key: "fa", min: -(49 * 60), status: "ok", seen: 99 }]);
        await insertFeed(c, [{ key: "fa", min: -(47 * 60), status: "ok", seen: 8 }]);
        await insertFeed(c, [{ key: "fa", min: 1, status: "ok", seen: 4 }]);
        await insertFeed(c, [{ key: "fa", min: 2, status: "ok", seen: 7 }]);
        await insertFeed(c, [{ key: "fa", min: 3, status: "unchanged", seen: 5 }]);
        expect(await extent(c, "fa")).toEqual({ max_items: 8, version: 4 });
        await c.query("delete from feed_runs where feed_key = 'fa' and items_seen = 8");
        expect(await extent(c, "fa")).toEqual({ max_items: 7, version: 5 });
        await c.query("delete from feed_runs where feed_key = 'fa' and items_seen = 7");
        expect(await extent(c, "fa")).toEqual({ max_items: 5, version: 6 });
        expect(await versions(c)).toHaveLength(1);
      });
    });
  });

  describe("the ingestor's catalogue functions", () => {
    const register = (c: pg.ClientBase, key: string, label = "CC BY 4.0"): Promise<pg.QueryResult> =>
      c.query("select ingestor.register_feed($1, 'Source', 'test', 'CC-BY-4.0', $2, 'Test attribution', 300, 60, true, '1.0.0')", [key, label]);

    it("register_feed publishes an ingestor source into the catalogue and reopens it; a key that is no source or belongs to another publisher is refused; taken_feed_keys names the latter", async () => {
      await t.planted(async (c) => {
        await register(c, "src_one");
        await c.query("update feed_catalog set closed_at = now() where feed_key = 'src_one'");
        await register(c, "src_one", "CC BY 4.0 DE");
        const r = await one<{ provider: string; format: string; published_by: string; closed: boolean; label: string; cadence_s: number }>(
          c,
          "select provider, format, published_by, closed_at is not null as closed, licence_label as label, cadence_s from feed_catalog where feed_key = 'src_one'",
        );
        expect(r).toEqual({ provider: "test", format: "ingestor", published_by: "ingestor", closed: false, label: "CC BY 4.0 DE", cadence_s: 300 });
        expect((await refused(c, "select ingestor.register_feed('no_such', 'x', 'x', 'x', null, null, null, null, true, null)"))?.message).toMatch(/is not a registered ingestor source/);
        await c.query("insert into feed_catalog (feed_key, provider, display_name, licence_id, published_by) values ('src_two', 'other', 'Other', 'CC0-1.0', 'main')");
        expect((await refused(c, "select ingestor.register_feed('src_two', 'x', 'x', 'x', null, null, null, null, true, null)"))?.message).toMatch(/belongs to another publisher/);
        expect((await one<{ p: string }>(c, "select published_by as p from feed_catalog where feed_key = 'src_two'")).p).toBe("main");
        const taken = await rows<{ k: string }>(c, "select ingestor.taken_feed_keys(array['src_one', 'src_two', 'fa', 'none']) as k");
        expect(taken.map((x) => x.k)).toEqual(["fa", "src_two"]);
      });
    });

    it("registered_sources: every ingestor source with its catalogue cadence and label when the ingestor published it", async () => {
      await t.planted(async (c) => {
        await register(c, "src_one", "CC BY 4.0 (label)");
        await c.query("update ingestor.sources set status = 'disabled' where id = 'src_two'");
        const r = await rows<{ source_id: string; licence_label: string; cadence_s: number | null; enabled: boolean; display_name: string; dataset_url: string | null }>(
          c,
          "select source_id, display_name, licence_label, cadence_s, enabled, dataset_url from registered_sources order by 1",
        );
        expect(r).toEqual([
          { source_id: "src_one", display_name: "src_one", licence_label: "CC BY 4.0 (label)", cadence_s: 300, enabled: true, dataset_url: null },
          { source_id: "src_two", display_name: "src_two", licence_label: "CC-BY-4.0", cadence_s: null, enabled: false, dataset_url: null },
        ]);
      });
    });

    it("project_run writes one feed run per finished run of this transaction's source, once; every other case is refused", async () => {
      await t.planted(async (c) => {
        await register(c, "src_one");
        await c.query("insert into ingestor.source_state (source_id, etag, next_due_at) values ('src_one', 'W/\"e1\"', $1)", [at(30)]);
        const id = async (status: string, src = "src_one"): Promise<string> =>
          (
            await one<{ id: string }>(
              c,
              `insert into ingestor.runs (source_id, unit, pod, started_at, finished_at, status, fetched, inserted, updated, closed, error_class, error_message, http_status, duration_ms)
               values ($1, 'u1', 'p1', $2, $3, $4, 5, 1, 2, null, case when $4 = 'partial' then 'Timeout' end, case when $4 = 'partial' then 'too slow' end, 200, 1500) returning id::text`,
              [src, at(0), status === "running" ? null : at(1), status],
            )
          ).id;
        const partial = await id("partial");
        const running = await id("running");
        const other = await id("ok", "src_two");
        await c.query("select set_config('viafrei.source_id', 'src_one', true)");
        expect((await refused(c, "select ingestor.project_run(-1)"))?.message).toMatch(/no run/);
        expect((await refused(c, "select ingestor.project_run($1)", [running]))?.message).toMatch(/still running/);
        expect(await refused(c, "select ingestor.project_run($1)", [other])).toMatchObject({ code: "42501", message: expect.stringMatching(/belongs to src_two/) as unknown });
        await c.query("select ingestor.project_run($1)", [partial]);
        expect((await refused(c, "select ingestor.project_run($1)", [partial]))?.message).toMatch(/already projected/);
        const f = await one<Record<string, unknown>>(
          c,
          "select feed_key, status, items_seen, items_changed, items_inserted, items_updated, items_closed, error, note, worker_version, etag, http_status, duration_ms, next_due_at = $1::timestamptz as due from feed_runs",
          [at(30)],
        );
        expect(f).toEqual({ feed_key: "src_one", status: "degraded", items_seen: 5, items_changed: 3, items_inserted: 1, items_updated: 2, items_closed: null, error: "Timeout: too slow", note: "ingest unit u1 instance p1", worker_version: "test", etag: 'W/"e1"', http_status: 200, duration_ms: 1500, due: true });
        expect((await state(c, "feed")).map((x) => [x.key, x.status])).toEqual([["src_one", "degraded"]]);
        const limited = await id("limited");
        await c.query("select ingestor.project_run($1)", [limited]);
        expect((await rows<{ s: string }>(c, "select status as s from feed_runs order by id")).map((x) => x.s)).toEqual(["degraded", "held"]);
        // a source the ingestor has not registered as a feed
        await c.query("select set_config('viafrei.source_id', 'src_two', true)");
        expect((await refused(c, "select ingestor.project_run($1)", [other]))).toMatchObject({ code: "42501", message: expect.stringMatching(/not a feed the ingestor registered/) as unknown });
      });
    });
  });

  describe("runtime_config's source bounds", () => {
    const put = (c: pg.ClientBase, key: string, value: string): ReturnType<typeof refused> =>
      refused(c, "insert into runtime_config (key, value, changed_by, reason) values ($1, $2, 'owner', 'set by the test')", [key, value]);

    it("a source key names a declared source; an interval is within its floor and four times its declared cadence; other keys pass untouched", async () => {
      await t.planted(async (c) => {
        expect((await put(c, "source.nobody.paused", "true"))?.detail).toBe("unknown-source");
        expect((await put(c, "source.fa.interval_s", "59"))?.detail).toBe("below-floor");
        expect((await put(c, "source.fa.interval_s", "241"))?.detail).toBe("above-stretch");
        expect(await put(c, "source.fa.interval_s", "240")).toBeNull();
        expect(await put(c, "source.fa.paused", "true")).toBeNull();
        // the catalogue's licence floor and the schedule's floor raise the 60 s minimum
        await c.query("update feed_catalog set min_interval_s = 90 where feed_key = 'fb'");
        expect((await put(c, "source.fb.interval_s", "89"))?.detail).toBe("below-floor");
        await c.query(
          "insert into source_schedule (source_key, host, declared_cadence_s, granted_cadence_s, floor_s) values ('sched_only', 'ingest-dwd', 100, 150, 150)",
        );
        expect((await put(c, "source.sched_only.interval_s", "149"))?.detail).toBe("below-floor");
        expect((await put(c, "source.sched_only.interval_s", "401"))?.detail).toBe("above-stretch");
        expect(await put(c, "source.sched_only.interval_s", "400")).toBeNull();
        // a closed catalogue row declares nothing; an update is checked too
        await c.query("update feed_catalog set closed_at = now() where feed_key = 'fc'");
        expect((await put(c, "source.fc.paused", "true"))?.detail).toBe("unknown-source");
        expect((await refused(c, "update runtime_config set value = '30' where key = 'source.fa.interval_s'"))?.detail).toBe("below-floor");
        expect(await put(c, "fuel.ask_ids", "3")).toBeNull();
      });
    });
  });
});
