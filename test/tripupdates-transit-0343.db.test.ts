/**
 * 0343: tripupdates (DELFI GTFS-RT Trip Updates, register row delfi_rt_tu)
 * answers for transit.
 *
 *  - the domain of every contract source, read as the API's licence gate
 *    reads it, before 0343 (0342's contract_source_domains, in a rolled-back
 *    transaction) and after: tripupdates moves from roads to transit, and
 *    nothing else changes, not even the set of sources;
 *  - the new row maps that key alone: a key that only contains it stays where
 *    it was;
 *  - the view keeps its columns, owner, grants and comment;
 *  - the file applied again is a no-op.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0343 tripupdates answers for transit", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0343 test did not run");
    });
  });
}

const FILE = "0343_tripupdates_transit.sql";

/** Feeds as production's feed_catalog holds them, one or more per domain, and two keys near tripupdates. */
const FEEDS: readonly (readonly [string, string])[] = [
  ["tripupdates", "delfi_rt_tu"],
  ["delfi_rt_tu", "delfi_rt_tu"],
  ["delfi_siri_et", "delfi_siri_et"],
  ["flix-trip-updates", "odbl-1.0"],
  ["h2_mobility", "mobilithek_h2_stations"],
  ["afir_enbw_stat", "afir_enbw"],
  ["mobilithek_bab_messages", "autobahn"],
  ["mobilithek_park_x", "mobilithek_park_x"],
  ["bochum-baustellen", "cc0-1.0"],
  ["dwd_warnings", "dwd"],
  ["db_fasta", "db_fasta"],
  ["vbb_tripupdates", "vbb"],
  ["tripupdates_archive", "delfi_rt_tu"],
];

/** Each contract source and the domain the gate gives it: the first pattern by priority that matches. */
const DOMAINS = `select s.source_ref, d.domain
  from public.contract_sources s
  left join lateral (select d.domain from public.contract_source_domains d where s.source_ref ~ d.pattern order by d.priority limit 1) d on true
 order by 1`;

interface Row {
  source_ref: string;
  domain: string;
}

/** 0342's create or replace view statement of contract_source_domains. */
function view0342(): string {
  const text = readFileSync(join(REPO, "db", "migrations", "0342_register_h2_flix_roads.sql"), "utf8");
  const m = /create or replace view public\.contract_source_domains as\n[\s\S]*?;\n/.exec(text);
  if (m === null) throw new Error("0342 has no create or replace view public.contract_source_domains");
  return m[0];
}

async function domains(c: pg.Pool | pg.PoolClient): Promise<Map<string, string>> {
  return new Map((await c.query<Row>(DOMAINS)).rows.map((r) => [r.source_ref, r.domain]));
}

/** The view's owner, grants, comment and columns. */
async function shape(c: pg.Pool | pg.PoolClient): Promise<{ owner: string; acl: string | null; comment: string | null; cols: string[] }> {
  const { rows } = await c.query<{ owner: string; acl: string | null; comment: string | null; cols: string[] }>(
    `select c.relowner::regrole::text as owner, c.relacl::text as acl, obj_description(c.oid, 'pg_class') as comment,
            (select array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
               from pg_attribute a where a.attrelid = c.oid and a.attnum > 0) as cols
       from pg_class c where c.oid = 'public.contract_source_domains'::regclass`,
  );
  const r = rows[0];
  if (r === undefined) throw new Error("no contract_source_domains");
  return r;
}

describe.skipIf(url === undefined)("0343 tripupdates answers for transit", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "tu0343");

  async function seed(): Promise<void> {
    for (const [key, id] of FEEDS) {
      await t.pool.query(
        `insert into public.feed_catalog (feed_key, provider, display_name, licence_id, licence_label, attribution)
         values ($1, 'test', $1, $2, 'Test', 'Test: ' || $1) on conflict do nothing`,
        [key, id],
      );
    }
  }

  /** `read` run against 0342's contract_source_domains, in a transaction rolled back. */
  async function at0342<T>(read: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await t.pool.connect();
    try {
      await c.query("begin");
      await c.query(view0342());
      return await read(c);
    } finally {
      await c.query("rollback");
      c.release();
    }
  }

  it("tripupdates moves from roads to transit, every other source keeps its domain", async () => {
    await seed();
    const was = await at0342(domains);
    const now = await domains(t.pool);
    expect([...now.keys()]).toEqual([...was.keys()]);
    expect(now.size).toBeGreaterThan(FEEDS.length);
    expect([...now].filter(([k, d]) => was.get(k) !== d)).toEqual([["tripupdates", "transit"]]);
    expect(was.get("tripupdates")).toBe("roads");
    // The row is anchored: a key that only contains tripupdates stays where it was.
    expect(now.get("tripupdates_archive")).toBe("roads");
    expect(now.get("vbb_tripupdates")).toBe("transit");
    expect(now.get("h2_mobility")).toBe("energy");
    expect(now.get("mobilithek_bab_messages")).toBe("roads");
  });

  it("the view keeps its columns, owner, grants and comment", async () => {
    const now = await shape(t.pool);
    expect(await at0342(shape)).toEqual(now);
    expect(now.cols).toEqual(["priority:integer", "pattern:text", "domain:text"]);
    expect(now.comment).toMatch(/domain of each contract source/);
  });

  it("the file applied again is a no-op", async () => {
    const was = await domains(t.pool);
    await t.pool.query("delete from schema_migrations where version = 343");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual([FILE]);
    expect(await domains(t.pool)).toEqual(was);
  });
});
