import { describe, expect, it } from "vitest";
import { ensurePartitions, ensureStatement, MAX_DAYS, partitionDays } from "../src/partitions.js";
import { fakePsql } from "./helpers.js";

describe("ensureStatement", () => {
  it("names the function with the days, from 0 to MAX_DAYS", () => {
    expect(ensureStatement(0)).toBe("select ensure_daily_partitions(0);");
    expect(ensureStatement(MAX_DAYS)).toBe(`select ensure_daily_partitions(${String(MAX_DAYS)});`);
  });
  it.each([MAX_DAYS + 1, 401, -1, 1.5, Number.NaN])("refuses %s days before any SQL is made", (d) => {
    expect(() => ensureStatement(d)).toThrow(`days out of range: ${String(d)}`);
  });
  it("is the guard of ensurePartitions too: nothing reaches psql", async () => {
    const fake = fakePsql();
    await expect(ensurePartitions(fake.run, 401)).rejects.toThrow("days out of range: 401");
    expect(fake.calls).toEqual([]);
  });
});

describe("partitionDays", () => {
  it("reads a whole number up to MAX_DAYS, the fallback when unset", () => {
    expect(partitionDays(undefined, 7)).toBe(7);
    expect(partitionDays(" 30 ", 7)).toBe(30);
    expect(() => partitionDays("401", 7)).toThrow(`at most ${String(MAX_DAYS)}`);
    expect(() => partitionDays("x", 7)).toThrow("whole number");
  });
});
