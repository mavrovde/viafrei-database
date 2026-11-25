/**
 * 0349: the Hamburg and Dortmund car-park figures carry their publishers'
 * warnings as condition notes of their register rows.
 *
 *  - four notes, condition in de and en for hamburg_parkhaeuser and
 *    dortmund_parkhauser, each the MCP server's text verbatim;
 *  - no other register row gains or loses a note;
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
  describe("0349 register: parking occupancy caveats", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0349 test did not run");
    });
  });
}

const FILE = "0349_register_parking_occupancy_caveats.sql";
const IDS = ["dortmund_parkhauser", "hamburg_parkhaeuser"];

describe.skipIf(url === undefined)("0349 register: parking occupancy caveats", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "reg0349");

  const notes = async (): Promise<string[][]> =>
    (
      await t.pool.query<{ source_id: string; note_kind: string; lang: string; body: string }>(
        "select source_id, note_kind, lang, body from public.source_register_notes order by 1, 2, 3",
      )
    ).rows.map((r) => [r.source_id, r.note_kind, r.lang, r.body]);

  it("the two register rows carry their publisher's warning in both languages, verbatim", async () => {
    const mine = (await notes()).filter((n) => IDS.includes(n[0] ?? ""));
    expect(mine).toEqual([
      [
        "dortmund_parkhauser",
        "condition",
        "de",
        "Freie Plätze Dortmund: „Bei Störungen können die tatsächlichen Belegungszahlen abweichen! Bitte beachten Sie daher den aktuellen Zeitstempel der Daten.“ (Stadt Dortmund)",
      ],
      [
        "dortmund_parkhauser",
        "condition",
        "en",
        "Free spaces in Dortmund: the publisher states „Bei Störungen können die tatsächlichen Belegungszahlen abweichen!“ — during a fault of the guidance system the real figures may differ; mind the time of each reading.",
      ],
      ["hamburg_parkhaeuser", "condition", "de", "Freie Plätze der Hamburger Parkhäuser: „Diese Echtzeitdaten sind ungeprüft.“ (Freie und Hansestadt Hamburg)"],
      [
        "hamburg_parkhaeuser",
        "condition",
        "en",
        "Free spaces of the Hamburg car parks: the publisher states „Diese Echtzeitdaten sind ungeprüft.“ — these real-time figures are unverified.",
      ],
    ]);
  });

  it("the file applied again is a no-op, and no other note moves", async () => {
    const was = await notes();
    await t.pool.query("delete from schema_migrations where version = 349");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual([FILE]);
    expect(await notes()).toEqual(was);
    await t.pool.query("delete from public.source_register_notes where source_id = any($1)", [IDS]);
    await t.pool.query("delete from schema_migrations where version = 349");
    expect((await service().migrate("cli")).ok).toBe(true);
    expect(await notes()).toEqual(was);
  });
});
