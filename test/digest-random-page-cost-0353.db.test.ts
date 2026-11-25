/**
 * 0353: viafrei_digest's random_page_cost 1.1, a role setting in every
 * database (pg_db_role_setting, setdatabase 0), as production holds it by hand.
 *
 *  - a migration sets the row, and no IN DATABASE row of it exists;
 *  - the file applied again over the row (production's case) leaves it as it is;
 *  - over a server without the role the file is a no-op, not an error;
 *
 * The row is the server's, not the test database's: the test resets it first,
 * so a value left by another run cannot pass for this one.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0353 digest random_page_cost", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0353 test did not run");
    });
  });
}

const FILE = "0353_digest_random_page_cost.sql";

describe.skipIf(url === undefined)("0353 digest random_page_cost", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "rpc0353");

  /** Every pg_db_role_setting row of the role naming random_page_cost: the database ('*' = every database) and the value. */
  const rows = async (role = "viafrei_digest"): Promise<string[]> =>
    (
      await t.pool.query<{ r: string }>(
        `select coalesce(d.datname, '*') || ' ' || x as r
           from pg_db_role_setting s join pg_roles o on o.oid = s.setrole
           left join pg_database d on d.oid = s.setdatabase
           cross join unnest(s.setconfig) x
          where o.rolname = $1 and x like 'random_page_cost=%' order by 1`,
        [role],
      )
    ).rows.map((r) => r.r);

  const migrateFile = async (): Promise<void> => {
    await t.pool.query("delete from schema_migrations where version = 353");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual([FILE]);
  };

  it("sets the role's random_page_cost to 1.1 in every database, the one row of that setting, none IN DATABASE", async () => {
    await t.pool.query("alter role viafrei_digest reset random_page_cost");
    expect(await rows()).toEqual([]);
    await migrateFile();
    expect(await rows()).toEqual(["* random_page_cost=1.1"]);
  });

  it("applied again over the row production holds, leaves it as it is", async () => {
    const was = (await t.pool.query<{ c: string[] }>("select setconfig as c from pg_db_role_setting where setrole = 'viafrei_digest'::regrole and setdatabase = 0")).rows;
    expect(was).toHaveLength(1);
    await migrateFile();
    expect((await t.pool.query<{ c: string[] }>("select setconfig as c from pg_db_role_setting where setrole = 'viafrei_digest'::regrole and setdatabase = 0")).rows).toEqual(was);
  });

  it("over a server without the role the statement is a no-op, not an error", async () => {
    const absent = `vf_absent_${String(process.pid)}`;
    expect((await t.pool.query("select 1 from pg_roles where rolname = $1", [absent])).rowCount).toBe(0);
    const body = readFileSync(join(REPO, "db", "migrations", FILE), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("DO $$"))
      .join("\n");
    expect(body).toContain("viafrei_digest");
    await t.pool.query(body.replaceAll("viafrei_digest", absent));
    expect(await rows(absent)).toEqual([]);
  });
});
