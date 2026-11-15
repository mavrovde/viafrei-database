import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeFile } from "../src/migrations/files.js";
import { migrate, READ_LEDGER } from "../src/migrations/migrate.js";
import { GOLDEN_CASES, type Golden } from "./golden-cases.js";
import { fakePsql, REPO } from "./helpers.js";

const LOCK = { code: 3, stdout: "", stderr: "ERROR:  55P03: canceling statement due to lock timeout\n" };

/**
 * The goldens are the bash migrator's bytes. The TypeScript migrator sends one
 * call more after every unit psql reported as applied: a read of the ledger,
 * proving the unit reached its insert (a file that swallows its own insert
 * exits 0). Those reads are taken out before the comparison, counted, and left
 * out of the call numbers the fixtures fail by.
 */
const isRead = (args: readonly string[]): boolean => args.includes(READ_LEDGER);

describe("migrate sends the recorded bytes (test/golden/migrate)", () => {
  it.each(GOLDEN_CASES)("$name", async (c) => {
    const golden = JSON.parse(readFileSync(join(REPO, "test", "golden", "migrate", `${c.name}.json`), "utf8")) as Golden;
    expect(golden.calls.length, "a fixture with no calls proves nothing").toBeGreaterThan(1);
    const files = Object.entries(c.files)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([n, body]) => describeFile(n, Buffer.from(body)));
    let verifies = 0;
    let lastWasApply = false;
    const fake = fakePsql({
      fail: (_s, n) => {
        const args = fake.calls[n - 1]?.args ?? [];
        const verify = lastWasApply && isRead(args);
        lastWasApply = !args.includes("-c");
        if (verify) verifies += 1;
        return c.failCalls.includes(n - verifies) && !verify ? LOCK : null;
      },
    });
    const errs: string[] = [];
    const r = await migrate({ psql: fake.run, files, lockAttempts: c.attempts, lockPauseS: 0, sleep: () => Promise.resolve(), out: () => undefined, err: (l) => errs.push(l) });
    expect(r.exitCode).toBe(golden.exitCode);
    const sent = fake.calls.filter((x, i) => !(isRead(x.args) && i > 0 && !(fake.calls[i - 1]?.args ?? []).includes("-c")));
    expect(sent.map((x) => ({ args: [...x.args], stdin: x.script.toString("base64") }))).toEqual(golden.calls);
    expect(fake.calls.length - sent.length).toBe(r.applied.length);
    expect(errs.filter((l) => l.startsWith("✗")).at(-1) ?? "").toBe(golden.lastStderr);
  });
});
