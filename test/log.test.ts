import { describe, expect, it } from "vitest";
import { jsonLogger } from "../src/log.js";

describe("jsonLogger", () => {
  it("writes one JSON line per event in pino's shape: level, time, service, the fields, msg", () => {
    const lines: string[] = [];
    const log = jsonLogger((l) => lines.push(l), () => new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
    log.info({ action: "migrate" }, "done");
    log.warn({}, "slow");
    log.error({ ok: false }, "failed");
    expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([
      { level: 30, time: Date.UTC(2026, 0, 2, 3, 4, 5), service: "viafrei-database", action: "migrate", msg: "done" },
      { level: 40, time: Date.UTC(2026, 0, 2, 3, 4, 5), service: "viafrei-database", msg: "slow" },
      { level: 50, time: Date.UTC(2026, 0, 2, 3, 4, 5), service: "viafrei-database", ok: false, msg: "failed" },
    ]);
  });

  it("a field cannot replace the message", () => {
    const lines: string[] = [];
    jsonLogger((l) => lines.push(l)).info({ msg: "forged" }, "real");
    expect((JSON.parse(lines[0] ?? "{}") as { msg: string }).msg).toBe("real");
  });

  it("writes to stdout by default", () => {
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => {
      writes.push(s);
      return true;
    });
    try {
      jsonLogger().info({}, "hello");
    } finally {
      process.stdout.write = orig;
    }
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^\{"level":30,"time":\d+,"service":"viafrei-database","msg":"hello"\}\n$/);
  });
});
