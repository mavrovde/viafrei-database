/**
 * live.refresh_request and live.refresh_asker (0315): the on-demand refreshes
 * viafrei-api records and the live ingestor claims and settles — the grants,
 * the one open request per subject, the state transitions, the two
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
  describe("live.refresh_request", () => {
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

const ID = "0190a3c2-5f00-7000-8000-000000000001";
const ID2 = "0190a3c2-5f00-7000-8000-000000000002";
const insert = `insert into live.refresh_request (request_id, source, subject, subject_key, created_at)
  values ($1, 'fuel', '{"at":"ags:09162000"}', $2, now()) on conflict do nothing returning request_id`;
const keys = async (c: pg.PoolClient): Promise<void> => {
  await c.query("insert into access.plan values ('p', 'consumer', 'standard', '{}', '{}', now(), 1, 1, 0, 0)");
  await c.query(
    "insert into access.api_key (key_id, environment, plan_name, label, contact, mac, issued_at, expires_at, changed_at) values ('Abc123XYZ0', 'live', 'p', 'l', 'c', decode(repeat('00', 32), 'hex'), now(), now(), now())",
  );
};

describe.skipIf(url === undefined)("live.refresh_request", () => {
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
      const first = (await c.query(insert, [ID, "ags:09162000"])).rows;
      const asker = await tried(c, "insert into live.refresh_asker values ($1, 'Abc123XYZ0', now())", [ID]);
      const read = (await c.query("select count(*)::int as n from live.refresh_request r join live.refresh_asker a using (request_id)")).rows;
      return {
        first,
        asker,
        read,
        upd: await tried(c, "update live.refresh_request set state = 'refused', settled_at = now(), reason = 'x'"),
        del: await tried(c, "delete from live.refresh_asker"),
        unknownKey: await tried(c, "insert into live.refresh_asker values ($1, 'Zzz999XYZ0', now())", [ID]),
      };
    });
    expect(out).toEqual({ first: [{ request_id: ID }], asker: "ok", read: [{ n: 1 }], upd: "42501", del: "42501", unknownKey: "23503" });
  });

  it("holds one open request per source and subject key: a second insert does nothing until the first settles", async () => {
    const out = await t.planted(async (c) => {
      const a = (await c.query(insert, [ID, "ags:09162000"])).rowCount;
      const b = (await c.query(insert, [ID2, "ags:09162000"])).rowCount;
      const other = (await c.query(insert.replace("'fuel'", "'train_board'"), [ID2, "ags:09162000"])).rowCount;
      await c.query("delete from live.refresh_request where request_id = $1", [ID2]);
      await c.query("update live.refresh_request set state = 'refreshed', settled_at = now() where request_id = $1", [ID]);
      const c2 = (await c.query(insert, [ID2, "ags:09162000"])).rowCount;
      return [a, b, other, c2];
    });
    expect(out).toEqual([1, 0, 1, 1]);
  });

  it("viafrei_ingestor claims and settles a request, and changes nothing else, inserts and removes none", async () => {
    const out = await t.planted(async (c) => {
      await c.query(insert, [ID, "ags:09162000"]);
      await c.query("set local role viafrei_ingestor");
      const claim = await tried(
        c,
        "update live.refresh_request set state = 'claimed', claimed_at = now() where request_id = (select request_id from live.refresh_request where state = 'pending' order by created_at for update skip locked limit 1)",
      );
      return {
        claim,
        back: await tried(c, "update live.refresh_request set state = 'pending', claimed_at = null"),
        subject: await tried(c, "update live.refresh_request set subject_key = 'x'"),
        settle: await tried(c, "update live.refresh_request set state = 'refused', settled_at = now(), reason = 'no provider key'"),
        again: await tried(c, "update live.refresh_request set reason = 'other'"),
        ins: await tried(c, insert, [ID2, "pt:1,1"]),
        del: await tried(c, "delete from live.refresh_request"),
        askers: await tried(c, "select * from live.refresh_asker"),
      };
    });
    expect(out).toEqual({ claim: "ok", back: "23514", subject: "42501", settle: "ok", again: "23514", ins: "42501", del: "42501", askers: "42501" });
  });

  it("refuses a settled state without settled_at, a claim without claimed_at, an unknown state and a subject that is no object", async () => {
    const out = await t.planted(async (c) => [
      await tried(c, "insert into live.refresh_request (request_id, source, subject, subject_key, created_at, state) values ($1, 'fuel', '{}', 'k', now(), 'refreshed')", [ID]),
      await tried(c, "insert into live.refresh_request (request_id, source, subject, subject_key, created_at, state) values ($1, 'fuel', '{}', 'k', now(), 'claimed')", [ID]),
      await tried(c, "insert into live.refresh_request (request_id, source, subject, subject_key, created_at, state) values ($1, 'fuel', '{}', 'k', now(), 'done')", [ID]),
      await tried(c, "insert into live.refresh_request (request_id, source, subject, subject_key, created_at) values ($1, 'fuel', '[]', 'k', now())", [ID]),
      await tried(c, "insert into live.refresh_request (request_id, source, subject, subject_key, created_at) values ($1, 'Fuel', '{}', 'k', now())", [ID]),
    ]);
    expect(out).toEqual(["23514", "23514", "23514", "23514", "23514"]);
  });

  it("notifies the ingestor on insert and the row's waiters on settle", async () => {
    const l = new pg.Client({ connectionString: t.url });
    await l.connect();
    try {
      const got: { channel: string; payload: string | undefined }[] = [];
      l.on("notification", (n) => got.push({ channel: n.channel, payload: n.payload }));
      await l.query(`listen refresh_request; listen refresh_${ID.replaceAll("-", "")}`);
      await t.pool.query(insert, [ID, "ags:09162000"]);
      await t.pool.query("update live.refresh_request set state = 'claimed', claimed_at = now() where request_id = $1", [ID]);
      await t.pool.query("update live.refresh_request set state = 'none_due', settled_at = now() where request_id = $1", [ID]);
      await l.query("select 1");
      expect(got).toEqual([
        { channel: "refresh_request", payload: ID },
        { channel: `refresh_${ID.replaceAll("-", "")}`, payload: "none_due" },
      ]);
    } finally {
      await l.end();
      await t.pool.query("delete from live.refresh_request");
    }
  });

  it("prunes settled requests older than a date with their askers, never one settled less than 30 days ago, for api_access", async () => {
    const out = await t.planted(async (c) => {
      await keys(c);
      await c.query(
        "insert into live.refresh_request (request_id, source, subject, subject_key, created_at, state, settled_at) values ($1, 'fuel', '{}', 'a', now() - interval '40 days', 'refreshed', now() - interval '40 days'), ($2, 'fuel', '{}', 'b', now() - interval '2 days', 'refreshed', now() - interval '2 days')",
        [ID, ID2],
      );
      await c.query("insert into live.refresh_asker values ($1, 'Abc123XYZ0', now() - interval '40 days')", [ID]);
      await c.query("set local role api_access");
      const young = await tried(c, "select live.prune_refresh_requests(now() - interval '1 day')");
      const n = (await c.query<{ n: string }>("select live.prune_refresh_requests(now() - interval '30 days') as n")).rows[0]?.n;
      const left = (await c.query<{ id: string }>("select request_id as id from live.refresh_request")).rows.map((r) => r.id);
      const askers = (await c.query<{ n: number }>("select count(*)::int as n from live.refresh_asker")).rows[0]?.n;
      await c.query("reset role");
      await c.query("set local role viafrei_ingestor");
      const other = await tried(c, "select live.prune_refresh_requests(now() - interval '40 days')");
      return { young, n, left, askers, other };
    });
    expect(out).toEqual({ young: "P0001", n: "1", left: [ID2], askers: 0, other: "42501" });
  });
});
