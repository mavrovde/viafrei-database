/**
 * The CLI verbs that need a database or a process: the service and tar are
 * planted, so each verb's printing, exit code and shutdown are judged without
 * either. The service itself is tested in service.test.ts and against a real
 * database in migrate.db.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import http from "node:http";

type Rec = { ok: boolean; lines: string[]; exitCode: number };
type State = { calls: string[]; snapshot: Record<string, unknown>; rec: Rec; tar: { args: string[]; event: "close" | "error"; code: number | null } };
const state = vi.hoisted((): State => ({
  calls: [],
  snapshot: {},
  rec: { ok: true, lines: ["✓ done"], exitCode: 0 },
  tar: { args: [], event: "close", code: 0 },
}));

vi.mock("../src/service.js", () => ({
  DatabaseService: class {
    constructor(readonly d: { log: { info: (o: object, m: string) => void } }) {
      state.calls.push("new");
      d.log.info({}, "service constructed");
    }
    refresh(): Promise<void> {
      state.calls.push("refresh");
      return Promise.resolve();
    }
    snapshot(): Record<string, unknown> {
      return state.snapshot;
    }
    diagnostics(): Promise<unknown> {
      state.calls.push("diagnostics");
      return Promise.resolve({ sizeBytes: 1 });
    }
    migrate(trigger: string, dry: boolean): Promise<Rec> {
      state.calls.push(`migrate ${trigger} ${String(dry)}`);
      return Promise.resolve(state.rec);
    }
    ensurePartitions(trigger: string, days: number): Promise<Rec> {
      state.calls.push(`partitions ${trigger} ${String(days)}`);
      return Promise.resolve(state.rec);
    }
    analyze(table: string, trigger: string): Promise<Rec> {
      state.calls.push(`analyze ${table} ${trigger}`);
      return Promise.resolve(state.rec);
    }
    check(trigger: string): Promise<Rec> {
      state.calls.push(`check ${trigger}`);
      return Promise.resolve(state.rec);
    }
    schedule(): void {
      state.calls.push("schedule");
    }
    boot(): Promise<void> {
      state.calls.push("boot");
      return Promise.resolve();
    }
    close(): Promise<void> {
      state.calls.push("close");
      return Promise.resolve();
    }
  },
}));

vi.mock("node:child_process", () => ({
  spawn: (_cmd: string, args: string[]) => {
    state.tar.args = args;
    const t = new EventEmitter();
    setImmediate(() => (state.tar.event === "error" ? t.emit("error", new Error("ENOENT")) : t.emit("close", state.tar.code)));
    return t;
  },
}));

const { entry, isEntry, main } = await import("../src/cli.js");

let out: string[];
let err: string[];
const saved = { ...process.env };
const URL_ = "postgresql://u@127.0.0.1:1/test_x";

beforeEach(() => {
  out = [];
  err = [];
  state.calls = [];
  state.rec = { ok: true, lines: ["✓ done"], exitCode: 0 };
  state.snapshot = { schema: null, imageHead: 293, schemaReadiness: { ready: true, head: 293 } };
  vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => (err.push(String(c)), true));
  process.env["DATABASE_URL"] = URL_;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...saved };
});

describe("the one-shot verbs", () => {
  it.each<[string[], string]>([
    [["migrate"], "migrate cli false"],
    [["migrate", "--dry-run"], "migrate cli true"],
    [["partitions", "ensure"], "partitions cli 7"],
    [["partitions", "ensure", "--days", "3"], "partitions cli 3"],
    [["analyze", "fuel_prices"], "analyze fuel_prices cli"],
    [["check"], "check cli"],
  ])("%j runs its action, prints its lines on stdout and closes the service", async (argv, call) => {
    expect(await main(argv)).toBe(0);
    expect(state.calls).toEqual(["new", call, "close"]);
    expect(out.join("")).toBe("✓ done\n");
  });

  it("a failed action prints on stderr and returns its own exit code", async () => {
    state.rec = { ok: false, lines: ["✗ lock timeout"], exitCode: 75 };
    expect(await main(["migrate"])).toBe(75);
    expect(err.join("")).toContain("✗ lock timeout");
    // The service logs as JSON lines on stderr, never on stdout, where the verb's answer goes.
    expect(err.join("")).toMatch(/"msg":"service constructed"/);
    expect(out.join("")).toBe("");
  });

  it("status prints readiness, the image head and the diagnostics as JSON", async () => {
    expect(await main(["status"])).toBe(0);
    expect(state.calls).toEqual(["new", "refresh", "diagnostics", "close"]);
    expect(JSON.parse(out.join(""))).toEqual({ readiness: { ready: false, reason: "no-ledger", detail: "the ledger (schema_migrations) could not be read" }, imageHead: 293, diagnostics: { sizeBytes: 1 } });
  });

  it("head: READY N and exit 0 when ready", async () => {
    expect(await main(["head"])).toBe(0);
    expect(out.join("")).toBe("READY 293\n");
  });

  it("head: NOT READY with the reason and exit 1, and a note when the ledger is ahead", async () => {
    state.snapshot = { schema: { ahead: [294, 295] }, imageHead: 293, schemaReadiness: { ready: false, detail: "2 pending" } };
    expect(await main(["head"])).toBe(1);
    expect(out.join("")).toBe("NOT READY: 2 pending\nnote: the ledger holds 2 version(s) newer than this image\n");
    expect(state.calls.at(-1)).toBe("close");
  });

  it("an error that is not a configuration error is rethrown, not swallowed", async () => {
    state.rec = null as unknown as Rec;
    await expect(main(["check"])).rejects.toThrow(TypeError);
    expect(state.calls.at(-1)).toBe("close");
  });
});

describe("export-migrations", () => {
  it("runs tar over the schema directories and returns its exit code", async () => {
    state.tar = { args: [], event: "close", code: 0 };
    expect(await main(["export-migrations"])).toBe(0);
    expect(state.tar.args.slice(0, 2)).toEqual(["-c", "-C"]);
    expect(state.tar.args).toContain("db/migrations");
  });
  it("a tar that ends without a code, or cannot start, is exit 1", async () => {
    state.tar = { args: [], event: "close", code: null };
    expect(await main(["export-migrations"])).toBe(1);
    state.tar = { args: [], event: "error", code: 0 };
    expect(await main(["export-migrations"])).toBe(1);
  });
});

/** Two free ports, asked of the kernel and released again. */
async function freePorts(): Promise<[number, number]> {
  const one = async (): Promise<number> => {
    const s = http.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as { port: number }).port;
    await new Promise<void>((r) => s.close(() => r()));
    return port;
  };
  const a = await one();
  let b = await one();
  while (b === a) b = await one();
  return [a, b];
}

const get = (port: number, path: string, host = "127.0.0.1"): Promise<number> =>
  new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, headers: { host } }, (r) => {
      r.resume();
      resolve(r.statusCode ?? 0);
    }).on("error", reject);
  });

describe("serve", () => {
  it.each<[string, Record<string, string>, boolean]>([
    ["readiness only when DB_HOST is not set", {}, false],
    ["the interface port too when DB_HOST is set, actions on with a token and a secret", { DB_HOST: "db.example.org", DB_ALLOW_CIDR: "127.0.0.1/32", DB_OWNER_TOKEN_SHA256: "a".repeat(64), DB_SESSION_SECRET: "s".repeat(32) }, true],
    ["the interface port without actions when no token is set", { DB_HOST: "db.example.org", DB_ALLOW_CIDR: "127.0.0.1/32" }, true],
  ])("%s, and stops on a signal", async (_n, env, iface) => {
    const [ready, http_] = await freePorts();
    Object.assign(process.env, { VF_DB_BIND: "127.0.0.1", VF_DB_READY_PORT: String(ready), VF_DB_HTTP_PORT: String(http_) }, env);
    const before = process.listenerCount("SIGTERM");
    const beforeInt = process.listenerCount("SIGINT");
    const running = main(["serve"]);
    for (let i = 0; i < 100 && process.listenerCount("SIGTERM") === before; i++) await new Promise((r) => setTimeout(r, 5));
    expect(state.calls).toEqual(["new", "schedule", "boot"]);
    expect(await get(ready, "/healthz")).toBe(200);
    if (iface) expect(await get(http_, "/healthz", "db.example.org")).toBeGreaterThan(0);
    else await expect(get(http_, "/healthz")).rejects.toThrow();
    process.emit("SIGTERM");
    expect(await running).toBe(0);
    expect(state.calls.at(-1)).toBe("close");
    expect([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")]).toEqual([before, beforeInt]);
    expect(out.join("")).toContain(iface ? "interface port listening" : "DB_HOST is not set");
  });
});

describe("the entry point", () => {
  it("is this file only when node was started with it", () => {
    expect(isEntry([])).toBe(false);
    expect(isEntry(["node", "/no/such/file"])).toBe(false);
    expect(isEntry(process.argv)).toBe(false);
  });
  it("exits with main's code, and with 1 and the stack when main throws", async () => {
    const codes: number[] = [];
    await entry(["help"], (c) => void codes.push(c));
    expect(codes).toEqual([0]);
    state.rec = null as unknown as Rec;
    await entry(["check"], (c) => void codes.push(c));
    expect(codes).toEqual([0, 1]);
    expect(err.join("")).toMatch(/✗ TypeError/);
  });
});
