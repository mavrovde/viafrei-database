/**
 * The one test allowed past two seconds: every migration from an EMPTY
 * database to head, through the same service the image runs.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * It needs an empty PostGIS 16-3.4 database and psql on PATH. Without
 * TEST_DATABASE_URL it is skipped — unless VF_REQUIRE_DB=1, where a skip
 * would be a green line about nothing, so it fails instead.
 */
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { DatabaseService } from "../src/service.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("from empty to head", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the from-empty test did not run");
    });
  });
}

describe.skipIf(url === undefined)("from empty to head", () => {
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const svc = new DatabaseService({ config: loadConfig({ DATABASE_URL: url ?? "", DB_MIGRATE_LOCK_PAUSE_S: "1" }, "serve"), log });
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  afterAll(async () => {
    await svc.close();
    await pool.end();
  });

  it("starts from a database with no ledger", async () => {
    const r = await pool.query<{ t: string | null }>("select to_regclass('schema_migrations')::text as t");
    expect(r.rows[0]?.t, "TEST_DATABASE_URL must name an EMPTY database").toBeNull();
  });

  it("boots to READY at the image's head", async () => {
    await svc.boot(1_000);
    const s = svc.snapshot();
    expect(s.lastMigrate?.ok, s.lastMigrate?.lines.join("\n")).toBe(true);
    expect(s.readiness).toEqual({ ready: true, detail: `at head ${String(svc.files.length)}` });
  });

  // The ledger rows are the image's versions with their original names and
  // checksums: the baseline's ledger.tsv, then the files after it. What psql
  // is sent per file is held to the recorded traffic by test/golden.test.ts.
  it("records every file with its name and the checksum of its bytes", async () => {
    const rows = (await pool.query<{ version: number; name: string; checksum: string }>("select version, name, checksum from schema_migrations order by version")).rows;
    expect(rows.map((r) => [r.version, r.name, r.checksum])).toEqual(svc.files.map((f) => [f.version, f.name, f.checksum]));
  });

  it("passes check: head, today and tomorrow covered", async () => {
    const r = await svc.check("cli");
    expect(r.ok, r.lines.join("\n")).toBe(true);
  });

  it("applies nothing on a second run", async () => {
    const r = await svc.migrate("cli");
    expect(r.ok).toBe(true);
    expect(r.lines.filter((l) => l.startsWith("applying"))).toEqual([]);
    expect(r.lines.at(-1)).toBe(`✓ 0 migration(s) applied; head = ${String(svc.files.length)}`);
  });

  // A refusal the database itself raises reaches the caller as a sentence of
  // its own: no ticket number, code path or process name (test/neutral-texts.test.ts
  // holds every function's literals to that; this is the same rule, run).
  it("a function's error message stays neutral", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("create table vf_neutral_probe (k int) partition by range (k)");
      const e = await c.query("select ensure_daily_partitions()").then(
        () => null,
        (x: unknown) => x as { message: string; code?: string },
      );
      expect(e?.code).toBe("P0001");
      expect(e?.message).toMatch(/^ensure_daily_partitions: range-partitioned table\(s\) outside the daily schedule in schema public: vf_neutral_probe partitioned by RANGE \(k\)\. /);
      expect(e?.message).toMatch(/found for row"\.$/);
      expect(e?.message).not.toMatch(/#[0-9]|platform\/|-ingestor\b|\bpod\b|\bk8s\b|\bcli\/|\bsrc\//);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("collects the diagnostics against a real catalogue", async () => {
    const d = await svc.diagnostics();
    expect(d.versions.postgis).not.toBeNull();
    expect(d.partitions.length).toBeGreaterThan(0);
    expect(d.ledgerTail[0]?.version).toBe(svc.files.length);
  });
});
