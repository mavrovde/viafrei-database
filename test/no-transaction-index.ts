/**
 * What the DB tests of a `-- no-transaction:` index migration share (0317,
 * 0318): a database of their own migrated to head, with a service to migrate
 * it again; and the re-application of one file with its ledger row deleted,
 * production's case when the index was built by hand first.
 */
import { afterAll, beforeAll, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { DatabaseService } from "../src/service.js";
import { DomainDb, endPool } from "./domain-db.js";

/** Registers the suite's beforeAll/afterAll: a migrated database `t`, and `service()` to migrate it again. Call inside a describe. */
export function migratedSuite(url: string, suffix: string): { t: DomainDb; service: () => DatabaseService } {
  const t = new DomainDb(url, suffix);
  let svc: DatabaseService | undefined;

  beforeAll(async () => {
    await t.make([]);
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
    svc = new DatabaseService({ config: loadConfig({ DATABASE_URL: t.url, DB_MIGRATE_LOCK_PAUSE_S: "1" }, "serve"), log });
  }, 900_000);

  afterAll(async () => {
    const s = svc;
    if (s !== undefined) await endPool(s.pool, () => s.close());
    await t.drop();
  });

  return {
    t,
    service: () => {
      if (svc === undefined) throw new Error("no service");
      return svc;
    },
  };
}

/** Deletes `file`'s ledger row and migrates: the run succeeds, applies that file alone, and applies it outside a transaction. */
export async function reapply(t: DomainDb, svc: DatabaseService, file: string): Promise<void> {
  const version = Number(file.slice(0, 4));
  await t.pool.query("delete from schema_migrations where version = $1", [version]);
  const run = await svc.migrate("cli");
  expect(run.ok, run.lines.join("\n")).toBe(true);
  const applying = run.lines.filter((l) => l.startsWith("applying"));
  expect(applying.map((l) => l.split(" ")[1])).toEqual([file]);
  expect(applying[0]).toMatch(/\(no transaction — see the file's -- no-transaction: note\)$/);
}
