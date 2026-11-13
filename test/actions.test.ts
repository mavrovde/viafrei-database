import { describe, expect, it } from "vitest";
import { judge, TABLE_NAME } from "../src/actions.js";
import type { PartitionWindow } from "../src/diagnostics.js";
import { describeFile } from "../src/migrations/files.js";

const files = [describeFile("0001_a.sql", Buffer.from("a\n"))];
const rows = [{ version: 1, checksum: files[0]?.checksum ?? "" }];
const win = (o: Partial<PartitionWindow> = {}): PartitionWindow => ({
  schema: "public",
  name: "transit_delays",
  partitions: 40,
  has_default: false,
  default_rows_estimate: 0,
  oldest_from: null,
  newest_to: null,
  covers_now: true,
  covers_tomorrow: true,
  ...o,
});
const run = (o: Partial<Parameters<typeof judge>[0]> = {}): ReturnType<typeof judge> => judge({ files, rows, partitions: [win()], hasEnsureFunction: true, ...o });

describe("check's verdict", () => {
  it("passes at head with a covered tick table and no default partition (the schema's rule)", () => {
    const r = run();
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(["✓ schema at head 1 (1 migrations, checksums equal to this image's files)", "✓ 1 tick table(s): today and tomorrow covered"]);
  });
  it.each<[string, Partial<Parameters<typeof judge>[0]>, RegExp]>([
    ["a pending file", { rows: [] }, /schema: .*0001_a\.sql/],
    ["an unreadable ledger", { rows: null }, /schema:/],
    ["no ensure function", { hasEnsureFunction: false }, /does not exist/],
    ["an unknown ensure function", { hasEnsureFunction: null }, /could not be looked up/],
    ["an unreadable partition window", { partitions: null }, /could not be read/],
    ["no tick table at all", { partitions: [] }, /a check over nothing is not a pass/],
    ["no partition for now", { partitions: [win({ covers_now: false, covers_tomorrow: false })] }, /no partition for now/],
    ["no partition for tomorrow", { partitions: [win({ covers_tomorrow: false })] }, /no partition for tomorrow/],
  ])("fails on %s", (_n, o, re) => {
    const r = run(o);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toMatch(re);
  });
  it("warns, and still passes, on rows in a default partition and on versions ahead", () => {
    const r = run({ partitions: [win({ has_default: true, default_rows_estimate: 12 })], rows: [...rows, { version: 2, checksum: "x" }] });
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toMatch(/public\.transit_delays has a DEFAULT partition, which the schema does not create/);
    expect(r.lines.filter((l) => l.startsWith("⚠"))).toHaveLength(3);
  });
});

describe("TABLE_NAME", () => {
  it("takes a plain or schema-qualified lower-case identifier only", () => {
    for (const ok of ["trips", "public.stop_times", "_x9"]) expect(TABLE_NAME.test(ok)).toBe(true);
    for (const bad of ["Trips", "a.b.c", "x;y", "1a", "a b", `a${"b".repeat(63)}`]) expect(TABLE_NAME.test(bad)).toBe(false);
  });
});
