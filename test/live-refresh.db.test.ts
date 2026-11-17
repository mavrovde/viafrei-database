/**
 * live.refresh_requests and live.refresh_askers (0315): the on-demand
 * refreshes viafrei-api records and the live ingestor claims and settles, in
 * the shape of the live ingestor's request protocol — the grants, the one
 * open request per subject, the privacy checks (public ids only), the claim,
 * stale-claim sweep and settle as the ingestor runs them, the two
 * notifications and the 30-day prune.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { DomainDb } from "./domain-db.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("live.refresh_requests", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the live refresh test did not run");
    });
  });
}

/** The SQLSTATE fn fails with, or "ok". */
async function state(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

/** Runs one statement in a savepoint and returns its SQLSTATE, or "ok". */
async function tried(c: pg.PoolClient, sql: string, args: unknown[] = []): Promise<string> {
  await c.query("savepoint t");
  const s = await state(() => c.query(sql, args));
  await c.query(s === "ok" ? "release savepoint t" : "rollback to savepoint t");
  return s;
}

const FUEL = `insert into live.refresh_requests (source, subject, subject_key, requested_by)
  values ('fuel-prices-de', jsonb_build_object('at', $1::text), $1, 'site') on conflict do nothing returning id::text`;
const BOARD = `insert into live.refresh_requests (source, subject, subject_key, requested_by)
  values ('train-board-de', jsonb_build_object('eva', $1::text), $1, 'mcp') on conflict do nothing returning id::text`;
const keys = async (c: pg.PoolClient): Promise<void> => {
  await c.query("insert into access.plan values ('p', 'consumer', 'standard', '{}', '{}', now(), 1, 1, 0, 0)");
  await c.query(
    "insert into access.api_key (key_id, environment, plan_name, label, contact, mac, issued_at, expires_at, changed_at) values ('Abc123XYZ0', 'live', 'p', 'l', 'c', decode(repeat('00', 32), 'hex'), now(), now(), now())",
  );
};
/** The live ingestor's claim, stale-claim sweep and settle (its docs/protocol.md), verbatim but for the table. */
const CLAIM = `update live.refresh_requests r set claimed_at = clock_timestamp()
  where r.id in (select q.id from live.refresh_requests q
                  where q.state = 'pending' and q.claimed_at is null and q.source = any($1::text[])
                  order by q.created_at, q.id limit $2::int for update skip locked)
  returning r.id::text as id, r.source, r.subject, (extract(epoch from r.created_at) * 1000)::float8 as created_ms`;
const SWEEP = `update live.refresh_requests set claimed_at = null
  where source = any($1::text[]) and settled_at is null and claimed_at < clock_timestamp() - make_interval(secs => $2::int)`;
const SETTLE = `update live.refresh_requests set state = $2::text, settled_at = coalesce(to_timestamp($3::float8 / 1000), clock_timestamp()),
  reason = $4::text, reused = $5::boolean where id = any($1::bigint[]) and settled_at is null`;

describe.skipIf(url === undefined)("live.refresh_requests", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "live_refresh");

  beforeAll(async () => {
    await t.make([]);
  }, 180_000);

  afterAll(async () => {
    await t.drop();
  });

  it("api_access records a request and its asker and reads them, and changes or removes neither", async () => {
    const out = await t.planted(async (c) => {
      await keys(c);
      await c.query("set local role api_access");
      const id = (await c.query<{ id: string }>(FUEL, ["ags:09162000"])).rows[0]?.id;
      const asker = await tried(c, "insert into live.refresh_askers values ($1, 'Abc123XYZ0', now())", [id]);
      const read = (await c.query("select count(*)::int as n from live.refresh_requests r join live.refresh_askers a on a.request_id = r.id")).rows;
      return {
        asker,
        read,
        upd: await tried(c, "update live.refresh_requests set state = 'refused', settled_at = now(), reason = 'x'"),
        del: await tried(c, "delete from live.refresh_askers"),
        unknownKey: await tried(c, "insert into live.refresh_askers values ($1, 'Zzz999XYZ0', now())", [id]),
        board: await tried(c, "insert into domains.train_board_departures default values"),
      };
    });
    expect(out).toEqual({ asker: "ok", read: [{ n: 1 }], upd: "42501", del: "42501", unknownKey: "23503", board: "42501" });
  });

  it("holds one open request per source and subject key: a second insert does nothing until the first settles", async () => {
    const out = await t.planted(async (c) => {
      const a = (await c.query(FUEL, ["ags:09162000"])).rowCount;
      const b = (await c.query(FUEL, ["ags:09162000"])).rowCount;
      const other = (await c.query(BOARD, ["8000207"])).rowCount;
      await c.query("update live.refresh_requests set state = 'refreshed', settled_at = clock_timestamp() where source = 'fuel-prices-de'");
      const c2 = (await c.query(FUEL, ["ags:09162000"])).rowCount;
      return [a, b, other, c2];
    });
    expect(out).toEqual([1, 0, 1, 1]);
  });

  it("stores public ids only: a position, a cell, a station name, an extra field or a key other than the id is refused (privacy ruling R1, R2)", async () => {
    const ins = (source: string, subject: string, key: string): string =>
      `insert into live.refresh_requests (source, subject, subject_key) values ('${source}', '${subject}', '${key}')`;
    const out = await t.planted(async (c) => [
      await tried(c, ins("fuel-prices-de", '{"at":"pt:48.137,11.575"}', "pt:48.137,11.575")),
      await tried(c, ins("fuel-prices-de", '{"at":"ags:09162000"}', "cell:48.135,11.5725:true")),
      await tried(c, ins("fuel-prices-de", '{"at":"ags:09162000","snap":true}', "ags:09162000")),
      await tried(c, ins("fuel-prices-de", '{"at":"anchor:48.1,11.5"}', "anchor:48.1,11.5")),
      await tried(c, ins("train-board-de", '{"name":"München Hbf"}', "8000261")),
      await tried(c, ins("train-board-de", '{"eva":"80002x7"}', "80002x7")),
      await tried(c, ins("fuel-prices-de", '{"at":"anchor:a7-12.n"}', "anchor:a7-12.n")),
      await tried(c, ins("train-board-de", '{"eva":"8000261"}', "8000261")),
    ]);
    expect(out).toEqual(["23514", "23514", "23514", "23514", "23514", "23514", "ok", "ok"]);
  });

  it("viafrei_live_ingestor claims, sweeps and settles with the protocol's statements, and changes nothing else, inserts and removes none", async () => {
    const out = await t.planted(async (c) => {
      const id = (
        await c.query<{ id: string }>(
          `insert into live.refresh_requests (source, subject, subject_key, created_at) values ('fuel-prices-de', '{"at":"ags:09162000"}', 'ags:09162000', clock_timestamp() - interval '10 minutes') returning id::text as id`,
        )
      ).rows[0]?.id;
      await c.query("set local role viafrei_live_ingestor");
      const claimed = (await c.query<{ id: string; subject: unknown }>(CLAIM, [["fuel-prices-de"], 32])).rows;
      const none = (await c.query(CLAIM, [["train-board-de"], 32])).rowCount;
      await c.query("reset role");
      await c.query("update live.refresh_requests set claimed_at = created_at where id = $1", [id]);
      await c.query("set local role viafrei_live_ingestor");
      const swept = (await c.query(SWEEP, [["fuel-prices-de"], 300])).rowCount;
      const again = (await c.query(CLAIM, [["fuel-prices-de"], 32])).rowCount;
      return {
        claimed: claimed.map((r) => [r.id === id, r.subject]),
        none,
        swept,
        again,
        subject: await tried(c, "update live.refresh_requests set subject_key = 'x'"),
        settle: (await c.query(SETTLE, [[id], "refreshed", null, null, true])).rowCount,
        twice: (await c.query(SETTLE, [[id], "failed", null, "the write failed", false])).rowCount,
        changed: await tried(c, "update live.refresh_requests set reason = 'other'"),
        read: (await c.query("select state, reused, settled_at is not null as settled from live.refresh_requests")).rows,
        ins: await tried(c, FUEL, ["ags:05315000"]),
        del: await tried(c, "delete from live.refresh_requests"),
        askers: await tried(c, "select * from live.refresh_askers"),
      };
    });
    expect(out).toEqual({
      claimed: [[true, { at: "ags:09162000" }]],
      none: 0,
      swept: 1,
      again: 1,
      subject: "42501",
      settle: 1,
      twice: 0,
      changed: "23514",
      read: [{ state: "refreshed", reused: true, settled: true }],
      ins: "42501",
      del: "42501",
      askers: "42501",
    });
  });

  it("viafrei_live_ingestor writes the fuel path's run ledger and reads its tables, and nothing in access", async () => {
    const out = await t.planted(async (c) => {
      await c.query("set local role viafrei_live_ingestor");
      const run = (await c.query<{ id: string }>("insert into ingest_runs(provider, started_at) values ('tankerkoenig:prices', now()) returning id::text as id")).rows[0]?.id;
      return {
        run: await tried(c, "update ingest_runs set finished_at = now(), status = 'ok', rows = 0, bytes = 0, duration_ms = 1, note = 'n', error = null, body_sha256 = null where id = $1::bigint", [run]),
        latest: await tried(c, "select station_id, product, price, is_open from fuel_price_latest limit 1"),
        watch: await tried(c, "select * from fuel_station_watch limit 1"),
        lookup: await tried(c, "select eva_no from db_station_numbers limit 1"),
        runsDelete: await tried(c, "delete from ingest_runs"),
        access: await tried(c, "select * from access.api_key"),
      };
    });
    expect(out).toEqual({ run: "ok", latest: "ok", watch: "ok", lookup: "ok", runsDelete: "42501", access: "42501" });
  });

  it("refuses a settled state without settled_at, an open one with it, an unknown state or source, a subject that is no object, a free-text door, an empty reason and a claim before the request", async () => {
    const out = await t.planted(async (c) => [
      await tried(c, "insert into live.refresh_requests (source, subject, subject_key, state) values ('x-y', '{}', 'k', 'refreshed')"),
      await tried(c, "insert into live.refresh_requests (source, subject, subject_key, settled_at) values ('x-y', '{}', 'k', now())"),
      await tried(c, "insert into live.refresh_requests (source, subject, subject_key, state, settled_at) values ('x-y', '{}', 'k', 'done', now())"),
      await tried(c, "insert into live.refresh_requests (source, subject, subject_key) values ('x-y', '[]', 'k')"),
      await tried(c, "insert into live.refresh_requests (source, subject, subject_key) values ('Fuel', '{}', 'k')"),
      await tried(c, "insert into live.refresh_requests (source, subject, subject_key, requested_by) values ('x-y', '{}', 'k', 'A visitor')"),
      await tried(c, "insert into live.refresh_requests (source, subject, subject_key, reason) values ('x-y', '{}', 'k', '')"),
      await tried(c, "insert into live.refresh_requests (source, subject, subject_key, claimed_at) values ('x-y', '{}', 'k', now() - interval '1 day')"),
    ]);
    expect(out).toEqual(["23514", "23514", "23514", "23514", "23514", "23514", "23514", "23514"]);
  });

  it("notifies the ingestor on insert with the source, and the API's waiters on settle with the id", async () => {
    const l = new pg.Client({ connectionString: t.url });
    await l.connect();
    try {
      const got: { channel: string; payload: string | undefined }[] = [];
      l.on("notification", (n) => got.push({ channel: n.channel, payload: n.payload }));
      await l.query("listen live_refresh_requested; listen live_refresh_settled");
      const id = (await t.pool.query<{ id: string }>(FUEL, ["ags:09162000"])).rows[0]?.id;
      await t.pool.query("update live.refresh_requests set claimed_at = clock_timestamp() where id = $1", [id]);
      await t.pool.query("update live.refresh_requests set state = 'none_due', settled_at = clock_timestamp() where id = $1", [id]);
      await l.query("select 1");
      expect(got).toEqual([
        { channel: "live_refresh_requested", payload: "fuel-prices-de" },
        { channel: "live_refresh_settled", payload: id },
      ]);
    } finally {
      await l.end();
      await t.pool.query("delete from live.refresh_requests");
    }
  });

  it("prunes requests made before a date in any state with their askers, never one made less than 30 days ago, for api_access", async () => {
    const out = await t.planted(async (c) => {
      await keys(c);
      const old = (
        await c.query<{ id: string }>(
          `insert into live.refresh_requests (source, subject, subject_key, created_at) values ('fuel-prices-de', '{"at":"ags:09162000"}', 'ags:09162000', now() - interval '40 days') returning id::text as id`,
        )
      ).rows[0]?.id;
      const young = (
        await c.query<{ id: string }>(
          `insert into live.refresh_requests (source, subject, subject_key, created_at, state, settled_at) values ('fuel-prices-de', '{"at":"ags:05315000"}', 'ags:05315000', now() - interval '2 days', 'refreshed', now() - interval '2 days') returning id::text as id`,
        )
      ).rows[0]?.id;
      await c.query("insert into live.refresh_askers values ($1, 'Abc123XYZ0', now() - interval '40 days')", [old]);
      await c.query("set local role api_access");
      const early = await tried(c, "select live.prune_refresh_requests(now() - interval '1 day')");
      const n = (await c.query<{ n: string }>("select live.prune_refresh_requests(now() - interval '30 days') as n")).rows[0]?.n;
      const left = (await c.query<{ id: string }>("select id::text as id from live.refresh_requests")).rows.map((r) => r.id);
      const askers = (await c.query<{ n: number }>("select count(*)::int as n from live.refresh_askers")).rows[0]?.n;
      await c.query("reset role");
      await c.query("set local role viafrei_live_ingestor");
      const other = await tried(c, "select live.prune_refresh_requests(now() - interval '40 days')");
      return { early, n, left: left.length === 1 && left[0] === young, askers, other };
    });
    expect(out).toEqual({ early: "P0001", n: "1", left: true, askers: 0, other: "42501" });
  });
});
