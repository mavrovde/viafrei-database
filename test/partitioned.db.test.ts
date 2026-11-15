/**
 * Every partitioned table of schema public and what its retention needs from
 * the schema, held against a database migrated to head (#32 partitioned +
 * retention). The expected shape is test/partitions/expected.tsv; the
 * retention policy itself lives in viafrei's ingest (the retention column
 * names its source) and is checked here only for what the DATABASE must
 * provide: one detachable partition per UTC day, no default partition to
 * swallow a row outside the window, and the archive ledger's one row per day.
 *
 * The domains ticks are proved in their own files (charging-status-hydrogen,
 * parking, weather); the partition machinery itself in consumer.db.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { DomainDb } from "./domain-db.js";
import { REPO } from "./helpers.js";

type Row = { readonly table: string; readonly key: string; readonly brin: readonly string[]; readonly retention: string };

function expected(): Row[] {
  return readFileSync(join(REPO, "test", "partitions", "expected.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l, i) => {
      const [table = "", key = "", brin = "", retention = "", ...rest] = l.split("\t");
      if (rest.length > 0 || !/^(drop:\d+|archive|rollup)$/.test(retention)) throw new Error(`expected.tsv row ${String(i + 1)}: ${JSON.stringify(l)}`);
      return { table, key, brin: brin === "-" ? [] : brin.split(","), retention };
    });
}

/** What `serve`'s boot ensures: today+AHEAD (VF_DB_PARTITION_DAYS' serve default) and three days back. */
const AHEAD = loadConfig({ DATABASE_URL: "postgresql://x@127.0.0.1/x" }, "serve").partitionDays;
const BACK = 3;
const WINDOW = AHEAD + BACK + 1;

const daily = (): Row[] => expected().filter((r) => r.retention !== "rollup");
const db = new DomainDb(process.env["TEST_DATABASE_URL"] ?? "", "parted");

beforeAll(async () => {
  await db.make([]);
});
afterAll(async () => {
  await db.drop();
});

/** One owner transaction, always rolled back. */
async function rolledBack<T>(f: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    return await f(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

/** The children of `table` as `[name, from, to]`, oldest first. */
async function days(c: pg.ClientBase | pg.Pool, table: string): Promise<{ name: string; bound: string }[]> {
  return (
    await c.query<{ name: string; bound: string }>(
      "select n.nspname || '.' || k.relname as name, pg_get_expr(k.relpartbound, k.oid) as bound from pg_inherits i join pg_class k on k.oid = i.inhrelid join pg_namespace n on n.oid = k.relnamespace where i.inhparent = $1::regclass order by k.relname",
      [table],
    )
  ).rows;
}

describe("the partitioned tables of schema public", () => {
  it("the table names every partitioned table of public, key for key and BRIN for BRIN, and nothing else", async () => {
    const r = await db.pool.query<{ line: string }>(
      `select 'public.' || c.relname || E'\\t' || pg_get_partkeydef(c.oid) || E'\\t' ||
              coalesce((select string_agg(ic.relname, ',' order by ic.relname) from pg_index x join pg_class ic on ic.oid = x.indexrelid join pg_am am on am.oid = ic.relam where x.indrelid = c.oid and am.amname = 'brin'), '-') as line
         from pg_class c join pg_partitioned_table p on p.partrelid = c.oid
        where c.relnamespace = 'public'::regnamespace and not c.relispartition order by 1`,
    );
    expect(AHEAD).toBe(30);
    expect(r.rows.map((x) => x.line)).toEqual(expected().map((x) => `${x.table}\t${x.key}\t${x.brin.length === 0 ? "-" : x.brin.join(",")}`));
    expect(expected().length).toBe(20);
  });

  it("every daily tick is RANGE-partitioned by day on observed_at with no default partition, and a row outside its window is refused", async () => {
    const wrong: string[] = [];
    for (const t of daily()) {
      if (t.key !== "RANGE (observed_at)") wrong.push(`${t.table}: ${t.key}`);
      const def = await db.pool.query<{ d: boolean }>("select partdefid <> 0 as d from pg_partitioned_table where partrelid = $1::regclass", [t.table]);
      if (def.rows[0]?.d !== false) wrong.push(`${t.table}: has a default partition`);
      const got = await rolledBack(async (c) => {
        await c.query("set local session_replication_role = replica");
        return c.query(`insert into ${t.table} (observed_at) values (now() + interval '40 days')`).then(
          () => "accepted",
          (e: unknown) => (e as { code?: string }).code ?? "?",
        );
      });
      if (got !== "23514") wrong.push(`${t.table}: a row 40 days ahead gave ${got}`);
    }
    expect(wrong).toEqual([]);
  });

  it("serve's boot covers today-3 … today+30 for every daily tick, one partition per UTC day named <table>_YYYYMMDD, and nothing else", async () => {
    const want: string[] = [];
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    for (let i = -BACK; i <= AHEAD; i++) want.push(new Date(today.getTime() + i * 86_400_000).toISOString().slice(0, 10));
    const wrong: string[] = [];
    for (const t of daily()) {
      const got = await days(db.pool, t.table);
      const expectRows = want.map((d) => {
        const next = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        return { name: `${t.table}_${d.replaceAll("-", "")}`, bound: `FOR VALUES FROM ('${d} 00:00:00+00') TO ('${next} 00:00:00+00')` };
      });
      if (JSON.stringify(got) !== JSON.stringify(expectRows)) wrong.push(`${t.table}: ${JSON.stringify(got.map((x) => x.name))}`);
    }
    expect(wrong).toEqual([]);
  });

  it("every day partition carries each of its parent's indexes, the BRIN on observed_at included", async () => {
    const r = await db.pool.query<{ parent: string; part: string; missing: number }>(
      `select i.inhparent::regclass::text as parent, i.inhrelid::regclass::text as part,
              (select count(*)::int from pg_index px where px.indrelid = i.inhparent
                  and not exists (select from pg_inherits ii join pg_index cx on cx.indexrelid = ii.inhrelid where ii.inhparent = px.indexrelid and cx.indrelid = i.inhrelid)) as missing
         from pg_inherits i join pg_class p on p.oid = i.inhparent
        where p.relkind = 'p' and p.relnamespace = 'public'::regnamespace`,
    );
    expect(r.rows.filter((x) => x.missing > 0).map((x) => `${x.part}: ${String(x.missing)}`)).toEqual([]);
    expect(r.rows.length).toBe(daily().length * WINDOW);
  });
});

describe("what retention needs of each daily tick", () => {
  it("the no-archive ticks of viafrei's TICK_DROP_KEEP_DAYS drop their oldest day in one transaction, detach and drop, and the window stays whole", async () => {
    const drops = daily().filter((t) => t.retention.startsWith("drop:"));
    expect(drops.map((t) => t.table.replace("public.", "")).sort()).toEqual(
      ["autobahn_events", "connect_transit_delays", "delfi_siri_et_calls", "road_event_ticks", "transit_delays", "vbb_transit_delays", "vbn_siri_et_calls", "vrn_transit_delays"].sort(),
    );
    expect(drops.every((t) => t.retention === "drop:1")).toBe(true);
    for (const t of drops) {
      await rolledBack(async (c) => {
        const [oldest] = await days(c, t.table);
        if (oldest === undefined) throw new Error(`${t.table}: no partition`);
        await c.query(`alter table ${t.table} detach partition ${oldest.name}`);
        await c.query(`drop table ${oldest.name}`);
        expect((await days(c, t.table)).length).toBe(WINDOW - 1);
      });
    }
  });

  it("every archived tick takes one partition_archives row per day, refuses a second, and its detached day attaches back (the restore)", async () => {
    const archived = daily().filter((t) => t.retention === "archive");
    expect(archived.length).toBe(11);
    for (const t of archived) {
      await rolledBack(async (c) => {
        const [oldest] = await days(c, t.table);
        if (oldest === undefined) throw new Error(`${t.table}: no partition`);
        const day = oldest.name.slice(-8).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
        const ins = "insert into public.partition_archives (table_name, day, path, bytes, rows, sha256) values ($1, $2, '/raw/x.dump', 1, 0, repeat('a', 64))";
        await c.query(ins, [t.table.replace("public.", ""), day]);
        await c.query("savepoint again");
        const second = await c.query(ins, [t.table.replace("public.", ""), day]).then(
          () => "accepted",
          (e: unknown) => (e as { constraint?: string }).constraint ?? "?",
        );
        await c.query("rollback to savepoint again");
        expect(second).toBe("partition_archives_table_day");
        await c.query(`alter table ${t.table} detach partition ${oldest.name}`);
        expect((await days(c, t.table)).length).toBe(WINDOW - 1);
        await c.query(`alter table ${t.table} attach partition ${oldest.name} ${oldest.bound}`);
        expect(await days(c, t.table)).toContainEqual(oldest);
      });
    }
  });

  it("ops_rollup_feed is LIST-partitioned by bucket_day with no default partition, untouched by ensure_daily_partitions, and refuses a day it has no partition for", async () => {
    const [t] = expected().filter((r) => r.retention === "rollup");
    expect(t?.table).toBe("public.ops_rollup_feed");
    expect(t?.key).toBe("LIST (bucket_day)");
    expect(await days(db.pool, "public.ops_rollup_feed")).toEqual([]);
    const got = await rolledBack(async (c) => {
      await c.query("set local session_replication_role = replica");
      return c.query("insert into public.ops_rollup_feed (bucket_day) values (current_date)").then(
        () => "accepted",
        (e: unknown) => (e as { code?: string }).code ?? "?",
      );
    });
    expect(got).toBe("23514");
  });
});
