import { describe, expect, it } from "vitest";
import { ensurePartitions, ensureStatement, ensureSubject, MAX_DAYS, parseFromDate, partitionDays } from "../src/partitions.js";
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

describe("partitions ensure --days-back / --from (0304)", () => {
  it("writes the two-argument call for a number of days back, the one-argument call without", () => {
    expect(ensureStatement(7)).toBe("select ensure_daily_partitions(7);");
    expect(ensureStatement(7, { days: 40 })).toBe("select ensure_daily_partitions(7, 40);");
    expect(ensureStatement(0, { days: 0 })).toBe("select ensure_daily_partitions(0, 0);");
  });

  it("lets the database's current_date count the days from a start date", () => {
    expect(ensureStatement(2, { from: "2026-01-31" })).toBe("select ensure_daily_partitions(2, current_date - date '2026-01-31');");
  });

  it("refuses a back count out of range and a date that is not a calendar date", () => {
    expect(() => ensureStatement(1, { days: MAX_DAYS + 1 })).toThrow(/days back out of range/);
    expect(() => ensureStatement(1, { days: 1.5 })).toThrow(/days back out of range/);
    expect(() => ensureStatement(1, { from: "2026-13-01" })).toThrow(/--from must be a date/);
    expect(() => parseFromDate("2026-02-29")).toThrow(/--from must be a date/);
    expect(() => parseFromDate(" 2026-01-01")).toThrow(/--from must be a date/);
    expect(() => parseFromDate("2026-01-01'; drop table x; --")).toThrow(/--from must be a date/);
    expect(parseFromDate("2028-02-29")).toBe("2028-02-29");
  });

  it("records the run under a subject that says how far back", () => {
    expect(ensureSubject(7)).toBe("7");
    expect(ensureSubject(7, { days: 40 })).toBe("7 back 40");
    expect(ensureSubject(7, { from: "2026-01-31" })).toBe("7 from 2026-01-31");
  });

  it("passes the two-argument call to psql and reports how far back it reached", async () => {
    const seen: string[] = [];
    const ok = await ensurePartitions((_s, a = []) => (seen.push(a.join(" ")), Promise.resolve({ code: 0, stdout: "", stderr: "" })), 5, { days: 30 });
    expect(seen).toEqual(["-c select ensure_daily_partitions(5, 30);"]);
    expect(ok).toEqual({ exitCode: 0, message: "✓ partitions ensured for today+5, from today-30" });
    const from = await ensurePartitions(() => Promise.resolve({ code: 0, stdout: "", stderr: "" }), 5, { from: "2026-01-02" });
    expect(from.message).toBe("✓ partitions ensured for today+5, from 2026-01-02");
    const bad = await ensurePartitions(() => Promise.resolve({ code: 3, stdout: "", stderr: "ERROR:  days_back must be 0..400\n" }), 5, { from: "2099-01-01" });
    expect(bad).toEqual({ exitCode: 3, message: "✗ ensure_daily_partitions(5, from 2099-01-01) failed: ERROR:  days_back must be 0..400" });
  });
});
