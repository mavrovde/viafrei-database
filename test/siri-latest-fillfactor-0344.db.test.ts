/**
 * 0344: delfi_siri_et_calls_latest keeps half of every page free (fillfactor 50).
 *
 *  - the table's storage parameters after 0344: fillfactor 50, its autovacuum
 *    settings unchanged;
 *  - the file applied again is a no-op.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { describe, expect, it } from "vitest";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0344 SIRI latest fillfactor 50", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0344 test did not run");
    });
  });
}

const FILE = "0344_siri_latest_fillfactor_50.sql";

const options = async (q: { query: (s: string) => Promise<{ rows: { o: string[] | null }[] }> }): Promise<string[]> =>
  [...((await q.query("select reloptions as o from pg_class where oid = 'public.delfi_siri_et_calls_latest'::regclass")).rows[0]?.o ?? [])].sort();

describe.skipIf(url === undefined)("0344 SIRI latest fillfactor 50", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "ff0344");

  it("keeps half of every page free and its autovacuum settings", async () => {
    expect(await options(t.pool)).toEqual([
      "autovacuum_analyze_scale_factor=0.02",
      "autovacuum_vacuum_scale_factor=0.02",
      "fillfactor=50",
    ]);
  });

  it("the file applied again is a no-op", async () => {
    const before = await options(t.pool);
    await t.pool.query("delete from schema_migrations where version = 344");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual([FILE]);
    expect(await options(t.pool)).toEqual(before);
  });
});
