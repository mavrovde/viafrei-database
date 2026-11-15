/**
 * The cutover path: a database migrated by the shell migrator up to 0292 (its
 * ledger holds exactly 1..292 under ledger.tsv's names and checksums) reaches
 * the head through this service's migrate — the carried 0293, then every file
 * after it, the no-transaction index of 0294 included.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * The 0292 database is made from the baseline with ledger row 293 forgotten.
 * The carried 0293 only replaces functions by their reworded definitions and
 * sets two notes, so applying it over its own result is the same statement
 * run twice; what this test proves is the ledger path, which is the part a
 * shell-migrated database differs in. Skipped without TEST_DATABASE_URL
 * unless VF_REQUIRE_DB=1.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { assembleSchema, loadSchema, parseLedgerTsv, readBaseline } from "../src/migrations/baseline.js";
import { DatabaseService } from "../src/service.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./helpers.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("the cutover from a shell-migrated 0292", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the cutover test did not run");
    });
  });
}

describe.skipIf(url === undefined)("the cutover from a shell-migrated 0292", () => {
  const name = `test_vfdb_cutover_${String(process.pid)}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const own = new URL(url ?? "postgresql://x@127.0.0.1/x");
  own.pathname = `/${name}`;
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const config = loadConfig({ DATABASE_URL: own.toString(), DB_MIGRATE_LOCK_PAUSE_S: "1" }, "serve");
  const full = loadSchema(config.migrationsDir, config.baselineDir);
  const services: DatabaseService[] = [];
  let pool: pg.Pool | undefined;
  const db = (): pg.Pool => {
    if (pool === undefined) throw new Error("the test database was not made");
    return pool;
  };
  let lines: readonly string[] = [];
  let shell: (string | number)[][] = [];

  beforeAll(async () => {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    pool = new pg.Pool({ connectionString: own.toString(), max: 1 });
    // The baseline alone (its carried 0293, no file after it), then 293 forgotten: the shell ledger at 0292.
    const b = readBaseline(config.baselineDir);
    if (b === null) throw new Error("no baseline");
    const carriedOnly = assembleSchema(b, full.baseline?.carried ?? []);
    const first = new DatabaseService({ config, log, schema: carriedOnly });
    services.push(first);
    const r = await first.migrate("cli");
    expect(r.ok, r.lines.join("\n")).toBe(true);
    await pool.query("delete from schema_migrations where version = 293");
    shell = (await pool.query<{ version: number; name: string; checksum: string }>("select version, name, checksum from schema_migrations order by version")).rows.map((x) => [x.version, x.name, x.checksum]);
    const svc = new DatabaseService({ config, log, schema: full });
    services.push(svc);
    const m = await svc.migrate("cli");
    lines = m.lines;
    expect(m.ok, m.lines.join("\n")).toBe(true);
  }, 900_000);

  afterAll(async () => {
    await pool?.end();
    for (const s of services) await s.close();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  it("started from exactly the shell ledger: 1..292 with ledger.tsv's names and checksums", () => {
    const tsv = parseLedgerTsv(readFileSync(join(REPO, "db", "baseline", "ledger.tsv"), "utf8"));
    expect(tsv.length).toBe(293);
    expect(shell).toEqual(tsv.filter((x) => x.version <= 292).map((x) => [x.version, x.name, x.checksum]));
    expect(shell.length).toBe(292);
    expect(full.baseline?.carried?.map((f) => f.name)).toEqual(["0293_neutral_texts.sql"]);
  });

  it("applies the carried 0293 first, then every file after the baseline, in order, and nothing else", () => {
    const applying = lines.filter((l) => l.startsWith("applying")).map((l) => l.replace(/^applying (\S+).*$/, "$1"));
    expect(applying).toEqual(["0293_neutral_texts.sql", ...full.files.map((f) => f.name)]);
    expect(applying[1]).toBe("0294_weather_warnings_live_area_gist.sql");
    expect(lines.find((l) => l.startsWith("applying 0294_"))).toMatch(/\(no transaction — see the file's -- no-transaction: note\)$/);
  });

  it("ends at head with the ledger the image expects: every version, name and checksum", async () => {
    const rows = (await db().query<{ version: number; name: string; checksum: string }>("select version, name, checksum from schema_migrations order by version")).rows;
    expect(rows.map((x) => [x.version, x.name, x.checksum])).toEqual(full.all.map((f) => [f.version, f.name, f.checksum]));
    const svc = services[1];
    if (svc === undefined) throw new Error("no service");
    await svc.ensurePartitions("cli", 1);
    const c = await svc.check("cli");
    expect(c.ok, c.lines.join("\n")).toBe(true);
  });

  it("has the planar GiST of the open warnings: present, valid, over (area::geometry), partial on the live predicate", async () => {
    const r = await db().query<{ def: string; valid: boolean; ready: boolean; pred: string | null }>(
      `select pg_get_indexdef(i.indexrelid) as def, i.indisvalid as valid, i.indisready as ready, pg_get_expr(i.indpred, i.indrelid) as pred
         from pg_index i where i.indexrelid = to_regclass('public.weather_warnings_live_area_geom')`,
    );
    expect(r.rows).toEqual([
      {
        def: "CREATE INDEX weather_warnings_live_area_geom ON public.weather_warnings USING gist (((area)::geometry)) WHERE ((closed_at IS NULL) AND (deleted_at IS NULL))",
        valid: true,
        ready: true,
        pred: "((closed_at IS NULL) AND (deleted_at IS NULL))",
      },
    ]);
  });

  it("a second migrate applies nothing, and a rerun of 0294 over an INVALID leftover rebuilds it", async () => {
    const svc = services[1];
    if (svc === undefined) throw new Error("no service");
    const again = await svc.migrate("cli");
    expect(again.lines.filter((l) => l.startsWith("applying"))).toEqual([]);
    // A failed concurrent build leaves an INVALID index: the file drops it and builds it again.
    await db().query("update pg_index set indisvalid = false where indexrelid = 'public.weather_warnings_live_area_geom'::regclass");
    await db().query("delete from schema_migrations where version = 294");
    const redo = await svc.migrate("cli");
    expect(redo.ok, redo.lines.join("\n")).toBe(true);
    expect(redo.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual(["0294_weather_warnings_live_area_gist.sql"]);
    const v = await db().query<{ valid: boolean }>("select indisvalid as valid from pg_index where indexrelid = to_regclass('public.weather_warnings_live_area_geom')");
    expect(v.rows).toEqual([{ valid: true }]);
  });
});
