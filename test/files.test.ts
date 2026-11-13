import { describe, expect, it } from "vitest";
import { byName, describeFile, hasNoTransactionMarker, versionOf } from "../src/migrations/files.js";

describe("the file rules", () => {
  it("read the version as base-10, leading zeros and all", () => {
    expect(versionOf("0008_x.sql")).toBe(8);
    expect(versionOf("0292_x.sql")).toBe(292);
  });

  it("order by name", () => {
    expect(["0010_b.sql", "0002_a.sql", "0010_a.sql"].sort(byName)).toEqual(["0002_a.sql", "0010_a.sql", "0010_b.sql"]);
  });

  it("find the marker on line 20 and not on line 21, and only at the start of a line", () => {
    const pad = (n: number): string => "-- x\n".repeat(n);
    expect(hasNoTransactionMarker(Buffer.from(`${pad(19)}-- no-transaction: why\n`))).toBe(true);
    expect(hasNoTransactionMarker(Buffer.from(`${pad(20)}-- no-transaction: why\n`))).toBe(false);
    expect(hasNoTransactionMarker(Buffer.from(" -- no-transaction: indented\n"))).toBe(false);
  });

  it("hash the bytes, not a decoded string", () => {
    expect(describeFile("0001_a.sql", Buffer.from("a\r\n")).checksum).not.toBe(describeFile("0001_a.sql", Buffer.from("a\n")).checksum);
  });
});
