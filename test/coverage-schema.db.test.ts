/**
 * The schema coverage gate end to end (#32): a throwaway database migrated to
 * head through the service, its catalogue read and judged against
 * test/coverage/schema.tsv and gap.tsv; and the refusal of a database that was
 * never migrated.
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { spawnSync } from "node:child_process";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const url = process.env["TEST_DATABASE_URL"];
const required = process.env["VF_REQUIRE_DB"] === "1";

if (url === undefined && required) {
  describe("the schema coverage gate", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the coverage gate test did not run");
    });
  });
}

const gate = (args: string[]): { status: number | null; out: string } => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/coverage-schema.ts", ...args], { cwd: REPO, env: process.env, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

describe.skipIf(url === undefined)("the schema coverage gate", () => {
  it("passes over a database migrated to head: every object has a manifest or a gap row", () => {
    const r = gate([]);
    expect(r.out).toMatch(/^✓ schema coverage: \d+ of \d+ catalogue object\(s\) proved, \d+ in the gap, 0 missing, 0 stale, 0 unknown test\(s\)/m);
    expect(r.status).toBe(0);
  });

  it("refuses a database that was never migrated, with exit 2", async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const name = `test_vfdb_cov_empty_${String(process.pid)}`;
    const remove = `drop database if exists ${name} with (force)`;
    try {
      await admin.query(remove);
      await admin.query(`create database ${name}`);
      const own = new URL(url ?? "");
      own.pathname = `/${name}`;
      const r = gate(["--url", own.toString()]);
      expect(r.out).toContain("✗ refused: the database has no schema_migrations");
      expect(r.status).toBe(2);
    } finally {
      await admin.query(remove);
      await admin.end();
    }
  });
});
