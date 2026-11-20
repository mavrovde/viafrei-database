/**
 * The pure rules of `partitions retain` (src/retain.ts) and of `reclaim`'s
 * preconditions (src/reclaim.ts): the windows on their calendars, the maker's
 * band, the archive ledger's four states, the leftovers, and each refusal.
 * The statements themselves run against a database in db-owned-maintenance.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { addDays, archiveCutoff, berlinDay, dayOf, LEFTOVER_SQL, noArchiveCutoff, planRetain, type Retained } from "../src/retain.js";
import { refusals } from "../src/reclaim.js";

const at = (iso: string): Date => new Date(iso);
const day = (d: string): { lo: Date; hi: Date } => ({ lo: at(`${d}T00:00:00Z`), hi: at(`${addDays(d, 1)}T00:00:00Z`) });
const part = (parent: string, d: string, o: Partial<Retained> = {}): Retained => ({
  parent,
  partition: `${parent}_${d.replaceAll("-", "")}`,
  keepDays: 1,
  archive: false,
  ...day(d),
  pending: false,
  ledger: "none",
  hasRow: true,
  ...o,
});

describe("the calendars", () => {
  it("a partition name gives its day only when it spells a real one", () => {
    expect(dayOf("transit_delays_20261119")).toBe("2026-11-19");
    expect(dayOf("transit_delays_20260230")).toBeNull();
    expect(dayOf("transit_delays_default")).toBeNull();
    expect(dayOf("Transit_20261119")).toBeNull();
  });

  it("the no-archive window counts on the Berlin calendar, the archive window on the UTC one", () => {
    // 23:30 UTC on 11-19 is 00:30 on 11-20 in Berlin.
    const late = at("2026-11-19T23:30:00Z");
    expect(berlinDay(late)).toBe("2026-11-20");
    expect(noArchiveCutoff(late, 1)).toBe("2026-11-18");
    expect(noArchiveCutoff(at("2026-11-19T12:00:00Z"), 1)).toBe("2026-11-17");
    expect(archiveCutoff(late, 14)).toBe("2026-11-05");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("planRetain", () => {
  const now = at("2026-11-19T12:00:00Z");

  it("drops a no-archive day past keep + 1 Berlin days, keeps the newer, and inside the maker's three days back keeps an empty one", () => {
    const p = planRetain(
      [part("transit_delays", "2026-11-18"), part("transit_delays", "2026-11-17"), part("transit_delays", "2026-11-16", { hasRow: false }), part("transit_delays", "2026-11-15", { hasRow: false })],
      [],
      now,
    );
    expect(p.steps.map((s) => (s.kind === "drop-leftover" ? s.l.relation : `${s.kind} ${s.r.partition}`))).toEqual(["drop-unarchived transit_delays_20261117", "drop-unarchived transit_delays_20261115"]);
    expect({ kept: p.kept, held: p.held, lines: p.lines }).toEqual({ kept: 2, held: 0, lines: [] });
  });

  it("an archived day past keep_days UTC days is dropped only on a recorded dump; none and restored wait, dropped is HELD", () => {
    const a = { archive: true, keepDays: 28 };
    const p = planRetain(
      [
        part("fuel_prices", "2026-10-23", { ...a, ledger: "recorded" }),
        part("fuel_prices", "2026-10-21", { ...a, ledger: "recorded" }),
        part("fuel_prices", "2026-10-20", { ...a, ledger: "none" }),
        part("fuel_prices", "2026-10-19", { ...a, ledger: "restored" }),
        part("fuel_prices", "2026-10-18", { ...a, ledger: "dropped", hasRow: false }),
      ],
      [],
      now,
    );
    expect(p.steps.map((s) => (s.kind === "drop-leftover" ? s.l.relation : `${s.kind} ${s.r.partition} ${s.day}`))).toEqual(["drop-archived fuel_prices_20261021 2026-10-21"]);
    expect(p.kept).toBe(1);
    expect(p.held).toBe(1);
    expect(p.lines).toEqual([
      "– fuel_prices_20261020: past its 28 days, waiting for the cold store to record its dump",
      "– fuel_prices_20261019: past its 28 days, waiting for the cold store to record its fresh dump (restored since its drop)",
      "⚠ fuel_prices_20261018: HELD — partition_archives says it was dropped and no restore since explains why it exists; not dropped until somebody has looked",
    ]);
  });

  it("touches no partition whose name is no day or whose range is not exactly that UTC day", () => {
    const p = planRetain(
      [
        part("transit_delays", "2026-11-01", { partition: "transit_delays_old" }),
        part("transit_delays", "2026-11-01", { lo: null }),
        part("transit_delays", "2026-11-01", { hi: null }),
        part("transit_delays", "2026-11-01", { lo: at("2026-11-01T01:00:00Z") }),
        part("transit_delays", "2026-11-01", { hi: at("2026-11-08T00:00:00Z") }),
      ],
      [],
      now,
    );
    expect(p.steps).toEqual([]);
    expect(p.kept).toBe(0);
    expect(p.lines).toHaveLength(5);
    for (const l of p.lines) expect(l).toMatch(/not a <table>_YYYYMMDD partition of exactly that UTC day; not touched$/);
  });

  it("drops a detached leftover past its window and leaves a newer one or one whose name is no day", () => {
    const p = planRetain(
      [],
      [
        { table: "transit_delays", relation: "transit_delays_20261110", keepDays: 1 },
        { table: "transit_delays", relation: "transit_delays_20261118", keepDays: 1 },
        { table: "transit_delays", relation: "transit_delays_20261332", keepDays: 1 },
      ],
      now,
    );
    expect(p.steps).toEqual([{ kind: "drop-leftover", l: { table: "transit_delays", relation: "transit_delays_20261110", keepDays: 1 }, day: "2026-11-10" }]);
  });

  // A text guard only: the behaviour is proved by day 7 in db-owned-maintenance.db.test.ts.
  it("finds a no-archive leftover whatever partition_archives says of its day: the drop stamps a row it has, it never waits on one", () => {
    expect(LEFTOVER_SQL).not.toMatch(/partition_archives/);
    expect(LEFTOVER_SQL).toMatch(/not r\.archive/);
  });
});

describe("reclaim's preconditions", () => {
  const fine = { stale: 0, queued: 0, open_runs: 0, locked: true };
  const noon = at("2026-11-19T12:00:00Z");

  it("none when the prune is done, no load runs, the lock was taken and it is outside the load window", () => {
    expect(refusals(fine, noon)).toEqual([]);
    expect(refusals(fine, at("2026-11-19T21:59:00Z"))).toEqual([]);
    expect(refusals(fine, at("2026-11-19T23:31:00Z"))).toEqual([]);
  });

  it("one line per precondition that does not hold", () => {
    expect(refusals({ stale: 3, queued: 2, open_runs: 1, locked: false }, at("2026-11-19T22:00:00Z"))).toEqual([
      "the prune is not done: 3 stale trip(s) are still in trips",
      "the prune is not done: 2 retired trip(s) still have stop times to delete",
      "1 delfi_static/gtfs_roll run(s) are open: a load is running",
      "the GTFS write lock is held (a load or the catch-up prune)",
      "it is 22:00 UTC, inside the GTFS load window (22:00-23:30 UTC)",
    ]);
    expect(refusals(fine, at("2026-11-19T23:30:00Z"))).toEqual(["it is 23:30 UTC, inside the GTFS load window (22:00-23:30 UTC)"]);
  });
});
