import { describe, expect, it } from "vitest";
import { describeFile } from "../src/migrations/files.js";
import { compare, readiness, serviceReadiness, type Readiness } from "../src/migrations/plan.js";

const f1 = describeFile("0001_a.sql", Buffer.from("a\n"));
const f2 = describeFile("0002_b.sql", Buffer.from("b\n"));
const f3 = describeFile("0003_c.sql", Buffer.from("c\n"));
const files = [f1, f2, f3];
const row = (f: typeof f1): { version: number; checksum: string } => ({ version: f.version, checksum: f.checksum });

describe("compare", () => {
  it("an empty ledger: everything pending, heads 3 and 0", () => {
    const s = compare(files, []);
    expect(s.pending.map((f) => f.name)).toEqual(["0001_a.sql", "0002_b.sql", "0003_c.sql"]);
    expect([s.imageHead, s.databaseHead, s.applied]).toEqual([3, 0, 0]);
  });

  it("an applied file with another checksum is a mismatch, not applied and not pending", () => {
    const s = compare(files, [row(f1), { version: 2, checksum: "x" }, row(f3)]);
    expect(s.mismatches).toEqual([{ name: "0002_b.sql", version: 2, applied: "x", file: f2.checksum }]);
    expect(s.pending).toEqual([]);
    expect(s.applied).toBe(2);
  });

  it("ledger versions this image does not carry are ahead, ascending", () => {
    const s = compare(files, [row(f1), row(f2), row(f3), { version: 5, checksum: "e" }, { version: 4, checksum: "d" }]);
    expect(s.ahead).toEqual([4, 5]);
    expect(s.databaseHead).toBe(5);
  });

  it("a gap in the middle is pending even when the head is applied", () => {
    expect(compare(files, [row(f1), row(f3)]).pending.map((f) => f.version)).toEqual([2]);
  });
});

describe("readiness", () => {
  it("is READY only at head with equal checksums", () => {
    expect(readiness(compare(files, files.map(row)))).toEqual({ ready: true, reason: "at-head", head: 3 });
  });

  it("is READY at head while a newer image's versions are ahead", () => {
    expect(readiness(compare(files, [...files.map(row), { version: 4, checksum: "d" }])).ready).toBe(true);
  });

  it("is not ready with one file pending, naming it", () => {
    const r = readiness(compare(files, [row(f1), row(f2)]));
    expect(r).toMatchObject({ ready: false, reason: "pending" });
    expect(r.ready ? "" : r.detail).toContain("0003_c.sql");
  });

  it("is not ready with a mismatch, even with nothing pending", () => {
    expect(readiness(compare(files, [row(f1), { version: 2, checksum: "x" }, row(f3)]))).toMatchObject({ ready: false, reason: "mismatch" });
  });

  it("puts a mismatch before pending files", () => {
    expect(readiness(compare(files, [{ version: 1, checksum: "x" }]))).toMatchObject({ reason: "mismatch" });
  });

  it("is not ready when the ledger could not be read", () => {
    expect(readiness(null)).toMatchObject({ ready: false, reason: "no-ledger" });
  });

  it("is not ready for an image without migrations, even against an empty ledger", () => {
    expect(readiness(compare([], []))).toMatchObject({ ready: false, reason: "no-migrations" });
  });
});

describe("serviceReadiness", () => {
  const atHead: Readiness = { ready: true, reason: "at-head", head: 3 };
  it("needs the schema, the partitions and the roles", () => {
    expect(serviceReadiness(atHead, { partitions: true, roles: true })).toEqual({ ready: true, detail: "at head 3" });
    expect(serviceReadiness(atHead, { partitions: true, roles: "skipped" }).ready).toBe(true);
  });
  it("is not ready before the partitions ran, or when they failed", () => {
    expect(serviceReadiness(atHead, { partitions: null, roles: true })).toEqual({ ready: false, detail: "partitions not ensured yet" });
    expect(serviceReadiness(atHead, { partitions: false, roles: true })).toEqual({ ready: false, detail: "partitions ensure failed" });
  });
  it("is not ready before the roles ran, or when a required one failed", () => {
    expect(serviceReadiness(atHead, { partitions: true, roles: null })).toEqual({ ready: false, detail: "role passwords not applied yet" });
    expect(serviceReadiness(atHead, { partitions: true, roles: false })).toEqual({ ready: false, detail: "a required role password could not be applied" });
  });
  it("is not ready when the schema is not, whatever the steps say", () => {
    expect(serviceReadiness({ ready: false, reason: "pending", detail: "x" }, { partitions: true, roles: true })).toEqual({ ready: false, detail: "schema not at head: x" });
  });
});
