/**
 * The console's guard triggers and the small pure functions, by behaviour
 * (#32): ops_audit append-only with its one retention exception and the
 * retention job, the passkey cap and counter, the restart and run-now
 * guards, the frozen slugs, the per-session watch limit and its NOTIFY, and
 * vf_ledger_mask, vf_page_key, mcp_usage_traffic_class,
 * transit_odbl_departs_at, weather_warning_english, tick_brin_autosummarize.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { DomainDb } from "./domain-db.js";
import { one, refused, requireDb, rows, url } from "./schema-db.js";

requireDb("the console's guards and the small functions");

describe.skipIf(url === undefined)("the console's guards and the small functions", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "ops_fn");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const audit = (c: pg.ClientBase, at: string, ip: string | null): Promise<{ id: string }> =>
    one<{ id: string }>(c, `insert into ops_audit (at, actor, action, target, result, client_ip) values (${at}, 'owner', 'login', 'console', 'ok', $1) returning id::text`, [ip]);

  describe("ops_audit", () => {
    it("is append-only: an update or a delete is refused, except clearing the address of a row older than twelve months and nothing else", async () => {
      await t.planted(async (c) => {
        const fresh = await audit(c, "now()", "10.0.0.1");
        const old = await audit(c, "now() - interval '12 months 1 day'", "10.0.0.2");
        expect((await refused(c, "delete from ops_audit where id = $1", [old.id]))?.message).toMatch(/append-only: DELETE refused/);
        expect((await refused(c, "update ops_audit set client_ip = null where id = $1", [fresh.id]))?.message).toMatch(/append-only: UPDATE refused/);
        expect(await refused(c, "update ops_audit set client_ip = '10.9.9.9' where id = $1", [old.id])).not.toBeNull();
        expect(await refused(c, "update ops_audit set client_ip = null, result = 'failed' where id = $1", [old.id])).not.toBeNull();
        expect(await refused(c, "update ops_audit set client_ip = null where id = $1", [old.id])).toBeNull();
        expect(await refused(c, "update ops_audit set client_ip = null where id = $1", [old.id])).not.toBeNull();
      });
    });

    it("ops_audit_forget_ips clears the addresses older than twelve months, keeps the newer, and records one run a day — every run that cleared one", async () => {
      await t.planted(async (c) => {
        await audit(c, "now() - interval '12 months 1 day'", "10.0.0.2");
        await audit(c, "now() - interval '11 months'", "10.0.0.3");
        expect((await one<{ n: number }>(c, "select ops_audit_forget_ips() as n")).n).toBe(1);
        expect((await rows<{ ip: string | null }>(c, "select client_ip as ip from ops_audit order by at")).map((x) => x.ip)).toEqual([null, "10.0.0.3"]);
        expect((await one<{ n: number }>(c, "select ops_audit_forget_ips() as n")).n).toBe(0);
        const runs = await rows<{ rows: number; note: string }>(c, "select rows, note from ingest_runs where provider = 'ops_audit_retention' order by id");
        expect(runs).toEqual([{ rows: 1, note: "ops_audit.client_ip set to NULL on 1 row(s) older than 12 months" }]);
        // a second run the same day that cleared one is recorded too
        await audit(c, "now() - interval '13 months'", "10.0.0.4");
        expect((await one<{ n: number }>(c, "select ops_audit_forget_ips() as n")).n).toBe(1);
        const held = async (): Promise<number[]> => (await rows<{ rows: number }>(c, "select rows from ingest_runs where provider = 'ops_audit_retention' order by id")).map((x) => x.rows);
        expect(await held()).toEqual([1, 1]);
        await c.query("update ingest_runs set started_at = now() - interval '25 hours' where provider = 'ops_audit_retention'");
        await c.query("select ops_audit_forget_ips()");
        expect(await held()).toEqual([1, 1, 0]);
      });
    });
  });

  describe("ops_passkeys", () => {
    const key = (c: pg.ClientBase, n: number): Promise<string | null> =>
      refused(c, "insert into ops_passkeys (credential_id, public_key, label) values ($1, decode(repeat('ab', 32), 'hex'), $2)", [Buffer.from([n]), `key ${String(n)}`]).then((r) => r?.message ?? null);

    it("holds at most ten; the sign counter never goes back", async () => {
      await t.planted(async (c) => {
        for (let n = 1; n <= 10; n++) expect(await key(c, n)).toBeNull();
        expect(await key(c, 11)).toMatch(/at most ten passkeys/);
        await c.query("delete from ops_passkeys where label = 'key 10'");
        expect(await key(c, 12)).toBeNull();
        await c.query("update ops_passkeys set sign_count = 5 where label = 'key 1'");
        expect(await refused(c, "update ops_passkeys set sign_count = 5 where label = 'key 1'")).toBeNull();
        expect((await refused(c, "update ops_passkeys set sign_count = 4 where label = 'key 1'"))?.message).toMatch(/may not decrease \(5 -> 4\)/);
      });
    });
  });

  describe("ops_requests", () => {
    const ask = (c: pg.ClientBase, action: string, target: string, at = "now()", state = "pending"): ReturnType<typeof refused> =>
      refused(c, `insert into ops_requests (requested_at, action, target, requested_by, state) values (${at}, $1, $2, 'owner', $3)`, [action, target, state]);

    it("one restart per worker per five minutes; a refused one does not count; another worker is free", async () => {
      await t.planted(async (c) => {
        expect(await ask(c, "restart", "ingest-dwd", "now() - interval '5 minutes 1 second'")).toBeNull();
        expect(await ask(c, "restart", "ingest-dwd")).toBeNull();
        expect((await ask(c, "restart", "ingest-dwd", "now() + interval '4 minutes'"))?.message).toMatch(/less than five minutes ago/);
        expect(await ask(c, "restart", "ingest-autobahn", "now() + interval '4 minutes'")).toBeNull();
        await c.query("update ops_requests set state = 'refused' where target = 'ingest-dwd'");
        expect(await ask(c, "restart", "ingest-dwd", "now() + interval '4 minutes'", "refused")).toBeNull();
        expect(await ask(c, "restart", "ingest-dwd", "now() + interval '4 minutes'")).toBeNull();
      });
    });

    it("a run-now names a scheduled source, waits out its floor (the catalogue's licence floor if higher) and is one pending at a time", async () => {
      await t.planted(async (c) => {
        expect((await ask(c, "run-now", "nobody"))?.detail).toBe("unknown-source");
        await c.query(
          "insert into source_schedule (source_key, host, declared_cadence_s, granted_cadence_s, floor_s, last_request_at) values ('src', 'ingest-dwd', 300, 300, 60, now() - interval '100 seconds')",
        );
        await c.query("insert into feed_catalog (feed_key, provider, display_name, licence_id, min_interval_s) values ('src', 'p', 'Src', 'CC0-1.0', 120)");
        expect((await ask(c, "run-now", "src"))?.detail).toBe("below-floor");
        await c.query("update feed_catalog set closed_at = now() where feed_key = 'src'");
        expect(await ask(c, "run-now", "src")).toBeNull();
        expect((await ask(c, "run-now", "src"))?.detail).toBe("already-pending");
        await c.query("update ops_requests set state = 'done' where target = 'src'");
        await c.query("update source_schedule set floor_s = 101 where source_key = 'src'");
        expect((await ask(c, "run-now", "src"))?.detail).toBe("below-floor");
        await c.query("update source_schedule set last_request_at = null where source_key = 'src'");
        expect(await ask(c, "run-now", "src")).toBeNull();
      });
    });
  });

  describe("the frozen slugs", () => {
    it("a place slug is never changed, re-pointed or freed; its name may change", async () => {
      await t.planted(async (c) => {
        await c.query("insert into place_slugs (ags, slug, name) values ('05315000', 'koeln', 'Köln')");
        expect(await refused(c, "update place_slugs set name = 'Köln am Rhein' where ags = '05315000'")).toBeNull();
        expect((await refused(c, "update place_slugs set slug = 'koln' where ags = '05315000'"))?.message).toMatch(/never changed/);
        expect((await refused(c, "update place_slugs set ags = '05315001' where ags = '05315000'"))?.message).toMatch(/never changed/);
        expect((await refused(c, "delete from place_slugs where ags = '05315000'"))?.message).toMatch(/never freed/);
      });
    });

    it("a station slug likewise", async () => {
      await t.planted(async (c) => {
        await c.query("insert into db_stations (station_no, name, content_hash, first_seen_at, last_seen_at, updated_at) values ('3320', 'Köln Hbf', 'h', now(), now(), now()), ('3321', 'Köln Messe/Deutz', 'h', now(), now(), now())");
        await c.query("insert into station_slugs (slug, station_no, name) values ('koeln-hbf', '3320', 'Köln Hbf')");
        expect(await refused(c, "update station_slugs set name = 'Köln Hauptbahnhof' where slug = 'koeln-hbf'")).toBeNull();
        expect((await refused(c, "update station_slugs set slug = 'koeln' where slug = 'koeln-hbf'"))?.message).toMatch(/never changed/);
        expect((await refused(c, "update station_slugs set station_no = '3321' where slug = 'koeln-hbf'"))?.message).toMatch(/never changed/);
        expect((await refused(c, "delete from station_slugs where slug = 'koeln-hbf'"))?.message).toMatch(/never freed/);
      });
    });
  });

  describe("watches", () => {
    const open = (c: pg.ClientBase, session: string): ReturnType<typeof refused> =>
      refused(c, "insert into watches (session_id, kind, key, expires_at) values ($1, 'road', 'A1', now() + interval '1 hour')", [session]);

    it("ten open watches per session; a stopped one frees its place; another session is free", async () => {
      await t.planted(async (c) => {
        for (let i = 0; i < 10; i++) expect(await open(c, "s1")).toBeNull();
        const r = await open(c, "s1");
        expect(r).toMatchObject({ code: "23514" });
        expect(r?.message).toMatch(/already has 10 open watches/);
        expect(await open(c, "s2")).toBeNull();
        await c.query("update watches set stopped_at = now() where id = (select min(id) from watches where session_id = 's1')");
        expect(await open(c, "s1")).toBeNull();
      });
    });

    it("an event notifies viafrei_watch with its watch and its id, once committed", async () => {
      const own = new URL(url ?? ""); own.pathname = `/${t.name}`;
      const listener = new pg.Client({ connectionString: own.toString() });
      await listener.connect();
      try {
        const got: string[] = [];
        listener.on("notification", (n) => got.push(`${n.channel} ${n.payload ?? ""}`));
        await listener.query("listen viafrei_watch");
        const c = await t.pool.connect();
        let ids: { w: string; e: string };
        try {
          await c.query("begin");
          const w = await one<{ id: string }>(c, "insert into watches (session_id, kind, key, expires_at) values ('n1', 'road', 'A1', now() + interval '1 hour') returning id::text");
          const e = await one<{ id: string }>(c, "insert into watch_events (watch_id, summary, as_of) values ($1, 'Stau', now()) returning id::text", [w.id]);
          ids = { w: w.id, e: e.id };
          await c.query("commit");
        } finally {
          c.release();
        }
        for (let i = 0; i < 50 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
        expect(got).toEqual([`viafrei_watch {"v":1,"watch_id":${ids.w},"event_id":${ids.e}}`]);
        await t.pool.query("delete from watches where session_id = 'n1'");
      } finally {
        await listener.end();
      }
    });
  });

  describe("the small functions", () => {
    it("vf_ledger_mask masks IPv4 and IPv6 addresses and leaves versions, times, ids and words alone", async () => {
      const cases: [string, string][] = [
        ["from 10.1.2.3 refused", "from <ip> refused"],
        ["peer 2001:db8::1 and ::1 gone", "peer <ip> and <ip> gone"],
        ["fe80:0:0:0:0:0:0:1 here", "<ip> here"],
        ["version 1.2.3 kept", "version 1.2.3 kept"],
        ["a 1.2.3.4.5 dotted run masks its first four", "a <ip>.5 dotted run masks its first four"],
        ["at 12:30:15 UTC", "at 12:30:15 UTC"],
        ["id a1.2.3.4 kept", "id a1.2.3.4 kept"],
        ["hash deadbeef:cafe kept", "hash deadbeef:cafe kept"],
        ["key abcdef::1 kept", "key abcdef::1 kept"],
        ["key 12345:1::2 kept", "key 12345:1::2 kept"],
        ["key 1::abcdef kept", "key 1::abcdef kept"],
      ];
      for (const [input, want] of cases) {
        expect([input, (await one<{ x: string }>(t.pool, "select vf_ledger_mask($1) as x", [input])).x]).toEqual([input, want]);
      }
    });

    it("vf_page_key: ten lower-case letters from the identity's sha256, the same for the same identity", async () => {
      const r = await one<{ a: string; b: string; c: string }>(t.pool, "select vf_page_key('one') as a, vf_page_key('one') as b, vf_page_key('two') as c");
      expect(r.a).toMatch(/^[a-z]{10}$/);
      expect(r.a).toBe(r.b);
      expect(r.c).not.toBe(r.a);
      const h = (await one<{ h: Buffer }>(t.pool, "select sha256(convert_to('one', 'UTF8')) as h")).h;
      expect(r.a).toBe(Array.from(h.subarray(0, 10), (b) => String.fromCharCode(97 + (b % 26))).join(""));
    });

    it("mcp_usage_traffic_class: our own probes are own, unknown and stateless are scanners, the rest real", async () => {
      const r = await rows<{ c: string; k: string }>(
        t.pool,
        "select c, mcp_usage_traffic_class(c) as k from unnest(array['viafrei-smoke', 'release-probe', 'viafrei-status-probe', 'deploy-probe', 'prod-round', 'viafrei-soak', 'viafrei-test-round', 'viafrei-own', 'unknown', 'stateless', 'claude-ai', 'Viafrei-Smoke']) c",
      );
      expect(r.map((x) => x.k)).toEqual(["own", "own", "own", "own", "own", "own", "own", "own", "scanners", "scanners", "real", "real"]);
    });

    it("transit_odbl_departs_at counts GTFS seconds from noon minus twelve hours, across the clock change", async () => {
      const r = await one<Record<string, string>>(
        t.pool,
        `select transit_odbl_departs_at('2026-03-29', 'Europe/Berlin', 3 * 3600)::text as spring, transit_odbl_departs_at('2026-10-25', 'Europe/Berlin', 3 * 3600)::text as autumn,
                transit_odbl_departs_at('2026-06-01', 'Europe/Berlin', 25 * 3600)::text as past_midnight, transit_odbl_departs_at('2026-06-01', 'UTC', 0)::text as utc`,
      );
      // noon local minus twelve hours: 22:00 UTC the day before under CEST, 23:00 under CET — 3 h later is 01:00 or 02:00 UTC
      expect(r).toEqual({ spring: "2026-03-29 01:00:00+00", autumn: "2026-10-25 02:00:00+00", past_midnight: "2026-06-01 23:00:00+00", utc: "2026-06-01 00:00:00+00" });
    });

    it("weather_warning_english: the English twin of a live German warning by its sending time, validity, cell and event; none when one differs", async () => {
      await t.planted(async (c) => {
        await c.query("set local session_replication_role = replica");
        const de = await one<{ id: string }>(
          c,
          `insert into weather_warnings (source_feed, source_id, identifier, warncell_id, version, level, official_sha256, valid_from, valid_to, published_at, area_sha256, raw)
           values ('dwd', 'dwd', 'id1', '805315000', 1, 2, repeat('a', 64), '2026-01-01 07:00Z', '2026-01-01 12:00Z', '2026-01-01 06:00Z', repeat('b', 64), '{"properties":{"EC_II":"51"}}') returning id::text`,
        );
        let n = 0;
        const en = (ii: string, cell: string, sent = "2026-01-01 06:00Z", hash = "1".repeat(64)): Promise<pg.QueryResult> =>
          c.query(
            `insert into weather_warnings_en (source_feed, source_id, identifier, base_identifier, language, sent_at, valid_from, valid_to, warncell_ids, raw, headline, description, instruction, content_sha256)
             values ('dwd_en', 'dwd', $5, 'b', 'en', $1, '2026-01-01 07:00Z', '2026-01-01 12:00Z', $2, jsonb_build_object('eventCodes', jsonb_build_object('II', $3::text)), 'Wind gusts', 'Gusts up to 60 km/h', 'Secure loose objects', $4)`,
            [sent, [cell], ii, hash, `en${String(++n)}`],
          );
        await en("52", "805315000", undefined, "e".repeat(64));
        await en("51", "805315001", undefined, "c".repeat(64));
        await en("51", "805315000", "2026-01-01 05:00Z", "d".repeat(64));
        const none = await rows(c, "select * from weather_warning_english($1)", [de.id]);
        expect(none).toEqual([]);
        await en("51", "805315000");
        expect(await rows(c, "select * from weather_warning_english($1)", [de.id])).toEqual([
          { en_headline: "Wind gusts", en_description: "Gusts up to 60 km/h", en_instruction: "Secure loose objects", en_sha256: "1".repeat(64) },
        ]);
        await c.query("update weather_warnings set deleted_at = now() where id = $1", [de.id]);
        expect(await rows(c, "select * from weather_warning_english($1)", [de.id])).toEqual([]);
      });
    });

    it("tick_brin_autosummarize turns autosummarize on for a partition's BRIN indexes once, and counts them", async () => {
      await t.planted(async (c) => {
        await c.query("create table test_brin_part (at timestamptz, v int)");
        await c.query("create index test_brin_part_at on test_brin_part using brin (at)");
        await c.query("create index test_brin_part_v on test_brin_part (v)");
        expect((await one<{ n: number }>(c, "select tick_brin_autosummarize('test_brin_part') as n")).n).toBe(1);
        expect((await one<{ o: string[] }>(c, "select reloptions as o from pg_class where relname = 'test_brin_part_at'")).o).toEqual(["autosummarize=on"]);
        expect((await one<{ n: number }>(c, "select tick_brin_autosummarize('test_brin_part') as n")).n).toBe(0);
      });
    });
  });
});
