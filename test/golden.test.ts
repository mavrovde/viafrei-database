import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeFile } from "../src/migrations/files.js";
import { migrate } from "../src/migrations/migrate.js";
import { GOLDEN_CASES, type Golden } from "./golden-cases.js";
import { fakePsql, REPO } from "./helpers.js";

const LOCK = { code: 3, stdout: "", stderr: "ERROR:  55P03: canceling statement due to lock timeout\n" };

describe("migrate sends the recorded bytes (test/golden/migrate)", () => {
  it.each(GOLDEN_CASES)("$name", async (c) => {
    const golden = JSON.parse(readFileSync(join(REPO, "test", "golden", "migrate", `${c.name}.json`), "utf8")) as Golden;
    expect(golden.calls.length, "a fixture with no calls proves nothing").toBeGreaterThan(1);
    const files = Object.entries(c.files)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([n, body]) => describeFile(n, Buffer.from(body)));
    const fake = fakePsql({ fail: (_s, n) => (c.failCalls.includes(n) ? LOCK : null) });
    const errs: string[] = [];
    const r = await migrate({ psql: fake.run, files, lockAttempts: c.attempts, lockPauseS: 0, sleep: () => Promise.resolve(), out: () => undefined, err: (l) => errs.push(l) });
    expect(r.exitCode).toBe(golden.exitCode);
    expect(fake.calls.map((x) => ({ args: [...x.args], stdin: x.script.toString("base64") }))).toEqual(golden.calls);
    expect(errs.filter((l) => l.startsWith("✗")).at(-1) ?? "").toBe(golden.lastStderr);
  });
});
