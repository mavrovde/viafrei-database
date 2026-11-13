import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeFile } from "../src/migrations/files.js";
import { compare, readiness, serviceReadiness } from "../src/migrations/plan.js";
import type { DatabaseService, Snapshot } from "../src/service.js";
import { createAccessPolicy } from "../src/server/access.js";
import { interfaceHandler, READINESS_HEADERS, readinessHandler, SECURITY_HEADERS, subjectValid } from "../src/server/http.js";

const files = [describeFile("0001_a.sql", Buffer.from("a\n")), describeFile("0002_b.sql", Buffer.from("b\n"))];
const snap = (applied: number, steps = { partitions: true as boolean | null, roles: "skipped" as const }): Snapshot => {
  const schema = compare(files, files.slice(0, applied).map((f) => ({ version: f.version, checksum: f.checksum })));
  const sr = readiness(schema);
  return { readiness: serviceReadiness(sr, steps), schema, schemaReadiness: sr, lastMigrate: null, lastAction: null, roles: null, busy: null, imageHead: 2, checkedAt: null };
};

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };
function request(port: number, o: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: o.method ?? "GET", path: o.path ?? "/", headers: o.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (b: Buffer) => chunks.push(b));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(o.body);
  });
}
function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

describe("the readiness port", () => {
  let current = snap(1);
  let s: { server: http.Server; port: number };
  beforeAll(async () => {
    s = await listen(readinessHandler({ snapshot: () => current }));
  });
  afterAll(() => s.server.close());

  it("/healthz is 200 while the process runs, ready or not", async () => {
    expect(await request(s.port, { path: "/healthz" })).toMatchObject({ status: 200, body: "ok\n" });
  });
  it("/ready is 503 naming the pending file, then 200 READY <head> at head", async () => {
    current = snap(1);
    const r = await request(s.port, { path: "/ready" });
    expect(r.status).toBe(503);
    expect(r.body).toContain("0002_b.sql");
    current = snap(2);
    expect(await request(s.port, { path: "/ready" })).toMatchObject({ status: 200, body: "READY 2\n" });
  });
  it("/ready is 503 at head until the partitions ran", async () => {
    current = snap(2, { partitions: null, roles: "skipped" });
    expect((await request(s.port, { path: "/ready" })).status).toBe(503);
  });
  it("answers nothing else: 404 for another path, 405 for a POST", async () => {
    expect((await request(s.port, { path: "/" })).status).toBe(404);
    expect((await request(s.port, { path: "/ready", method: "POST" })).status).toBe(405);
  });
  it("says nosniff and no-store on every answer, 200, 503, 404 and 405", async () => {
    expect(READINESS_HEADERS).toEqual({ "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    current = snap(1);
    for (const o of [{ path: "/healthz" }, { path: "/ready" }, { path: "/" }, { path: "/ready", method: "POST" }]) {
      const r = await request(s.port, o);
      for (const [k, v] of Object.entries(READINESS_HEADERS)) expect([o, k, r.headers[k.toLowerCase()]]).toEqual([o, k, v]);
    }
  });
});

describe("the interface port", () => {
  const TOKEN = "owner-token-for-the-test-0123";
  const SECRET = "x".repeat(40);
  const OWNER = "203.0.113.7";
  const started: string[] = [];
  const svc = {
    snapshot: () => snap(2),
    diagnostics: () => Promise.reject(new Error("no database in this test")),
    migrate: (t: string) => (started.push(`migrate:${t}`), Promise.resolve()),
    ensurePartitions: (t: string, d: number) => (started.push(`partitions:${t}:${String(d)}`), Promise.resolve()),
    analyze: (table: string, t: string) => (started.push(`analyze:${table}:${t}`), Promise.resolve()),
    check: (t: string) => (started.push(`check:${t}`), Promise.resolve()),
  } as unknown as DatabaseService;
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const policy = createAccessPolicy({ allowCidr: OWNER, trustedProxyCidr: "127.0.0.1/32", host: "db.example.test", warn: () => undefined });
  let s: { server: http.Server; port: number };
  beforeAll(async () => {
    s = await listen(interfaceHandler({ svc, policy, auth: { tokenSha256: createHash("sha256").update(TOKEN).digest("hex"), sessionSecret: SECRET }, log }));
  });
  afterAll(() => s.server.close());

  const as = (from: string, extra: Record<string, string> = {}): Record<string, string> => ({ host: "db.example.test", "x-forwarded-for": from, ...extra });
  const post = (path: string, body: Record<string, string>, extra: Record<string, string> = {}): Promise<Res> =>
    request(s.port, { method: "POST", path, headers: as(OWNER, { origin: "https://db.example.test", "content-type": "application/x-www-form-urlencoded", ...extra }), body: new URLSearchParams(body).toString() });
  const signIn = async (): Promise<string> => {
    const r = await post("/login", { token: TOKEN });
    expect(r.status).toBe(303);
    return String(r.headers["set-cookie"]?.[0]).split(";")[0] ?? "";
  };
  const field = (html: string, name: string): string => new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";

  it("refuses an address outside the allow-list with 403 and an empty body, on every path", async () => {
    for (const path of ["/", "/api/status.json", "/style.css", "/login"]) {
      const r = await request(s.port, { path, headers: as("198.51.100.1") });
      expect([r.status, r.body]).toEqual([403, ""]);
    }
  });
  it("refuses another Host with 421 and an empty body, even from the owner's address", async () => {
    expect(await request(s.port, { headers: as(OWNER, { host: "evil.example" }) })).toMatchObject({ status: 421, body: "" });
  });
  it("refuses an outsider with a wrong Host with 403, not 421: the allow-list is checked first", async () => {
    expect(await request(s.port, { headers: as("198.51.100.1", { host: "evil.example" }) })).toMatchObject({ status: 403, body: "" });
  });
  it("serves the page to the owner's address, with the security headers and no script", async () => {
    const r = await request(s.port, { headers: as(OWNER) });
    expect(r.status).toBe(200);
    expect(r.body).not.toMatch(/<script/i);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers[k.toLowerCase()]).toBe(v);
  });
  it("pins the security headers, value for value", () => {
    expect(SECURITY_HEADERS).toEqual({
      "Content-Security-Policy": "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    });
  });
  it("sends every security header on the stylesheet, the JSON, the redirect and every refusal (403, 404, 421)", async () => {
    const cases: [string, Promise<Res>, number][] = [
      ["style", request(s.port, { path: "/style.css", headers: as(OWNER) }), 200],
      ["json", request(s.port, { path: "/api/status.json", headers: as(OWNER) }), 200],
      ["redirect", post("/login", { token: TOKEN }), 303],
      ["outsider", request(s.port, { headers: as("198.51.100.1") }), 403],
      ["wrong host", request(s.port, { headers: as(OWNER, { host: "evil.example" }) }), 421],
      ["unknown", request(s.port, { method: "PUT", path: "/nowhere", headers: as(OWNER) }), 404],
      ["no session", request(s.port, { path: "/confirm?action=check", headers: as(OWNER) }), 403],
    ];
    for (const [name, p, status] of cases) {
      const r = await p;
      expect([name, r.status]).toEqual([name, status]);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect([name, k, r.headers[k.toLowerCase()]]).toEqual([name, k, v]);
    }
  });
  it("loads nothing from another origin: the page's one resource is the same-origin stylesheet", async () => {
    const r = await request(s.port, { headers: as(OWNER) });
    expect(r.body.match(/\b(?:src|href)="[^"]*"/g)).toEqual(['href="/style.css"']);
    expect(r.body).not.toMatch(/https?:\/\/|url\(/i);
  });
  it("serves the same state as JSON", async () => {
    const r = await request(s.port, { path: "/api/status.json", headers: as(OWNER) });
    expect(JSON.parse(r.body)).toMatchObject({ snapshot: { imageHead: 2 }, diagnostics: null, error: "no database in this test" });
  });
  it("refuses a sign-in with the wrong token, and from another Origin", async () => {
    expect((await post("/login", { token: "wrong-token-0123456789" })).status).toBe(403);
    expect((await post("/login", { token: TOKEN }, { origin: "https://evil.example" })).status).toBe(403);
  });
  it("needs a session for the confirmation page", async () => {
    expect((await request(s.port, { path: "/confirm?action=check", headers: as(OWNER) })).status).toBe(403);
  });
  it("runs an action only with session, CSRF and a confirmation, and each confirmation once", async () => {
    const cookie = await signIn();
    const page = await request(s.port, { path: "/confirm?action=analyze&subject=public.trips", headers: as(OWNER, { cookie }) });
    expect(page.status).toBe(200);
    const form = { action: "analyze", subject: "public.trips", csrf: field(page.body, "csrf"), confirm: field(page.body, "confirm") };
    expect((await post("/action", { ...form, csrf: "forged" }, { cookie })).status).toBe(403);
    expect((await post("/action", { ...form, subject: "public.stops" }, { cookie })).status).toBe(403);
    expect((await post("/action", form)).status).toBe(403);
    started.length = 0;
    expect((await post("/action", form, { cookie })).status).toBe(303);
    expect(started).toEqual(["analyze:public.trips:owner"]);
    expect((await post("/action", form, { cookie })).status).toBe(403);
    expect(started).toHaveLength(1);
  });
  it("refuses an action or subject it does not run", async () => {
    const cookie = await signIn();
    expect((await request(s.port, { path: "/confirm?action=drop", headers: as(OWNER, { cookie }) })).status).toBe(400);
    expect((await request(s.port, { path: "/confirm?action=analyze&subject=x;drop", headers: as(OWNER, { cookie }) })).status).toBe(400);
  });
  it("signs out with CSRF only", async () => {
    const cookie = await signIn();
    expect((await post("/logout", {}, { cookie })).status).toBe(403);
    const page = await request(s.port, { headers: as(OWNER, { cookie }) });
    const r = await post("/logout", { csrf: field(page.body, "csrf") }, { cookie });
    expect(r.status).toBe(303);
    expect(String(r.headers["set-cookie"]?.[0])).toContain("Max-Age=0");
  });
  it("revokes the session on sign-out: the same cookie replayed is no session", async () => {
    const cookie = await signIn();
    const csrf = field((await request(s.port, { headers: as(OWNER, { cookie }) })).body, "csrf");
    expect(csrf).not.toBe("");
    expect((await post("/logout", { csrf }, { cookie })).status).toBe(303);
    expect(field((await request(s.port, { headers: as(OWNER, { cookie }) })).body, "csrf")).toBe("");
    expect((await post("/logout", { csrf }, { cookie })).status).toBe(403);
  });
  it("refuses a body that is not a form", async () => {
    expect((await post("/login", {}, { "content-type": "application/json" })).status).toBe(400);
  });
});

describe("subjectValid", () => {
  it("takes '-' for migrate and check, 1..400 days for partitions, a plain name for analyze", () => {
    expect(subjectValid("migrate", "-")).toBe(true);
    expect(subjectValid("check", "x")).toBe(false);
    expect(subjectValid("partitions", "30")).toBe(true);
    expect(subjectValid("partitions", "0")).toBe(true);
    expect(subjectValid("partitions", "401")).toBe(false);
    expect(subjectValid("analyze", "public.trips")).toBe(true);
    expect(subjectValid("analyze", "trips; vacuum")).toBe(false);
  });
});

describe("the interface port at its edges", () => {
  const TOKEN = "owner-token-for-the-test-0123";
  const SECRET = "x".repeat(40);
  const OWNER = "203.0.113.7";
  const started: string[] = [];
  const errors: string[] = [];
  let state: { snapshot: () => Snapshot; jobFails: boolean } = { snapshot: () => snap(1), jobFails: false };
  const job = (name: string): Promise<void> => (started.push(name), state.jobFails ? Promise.reject(new Error("lost")) : Promise.resolve());
  const svc = {
    snapshot: () => state.snapshot(),
    diagnostics: () => Promise.resolve({ versions: { postgres: "16", postgis: "3.4", database: "d", now: new Date(0) }, sizeBytes: 1, largest: [], partitions: [], connections: [], longQueries: [], locks: [], vacuum: [], wraparound: [], vacuumRunning: 0, ledgerTail: [] }),
    migrate: (t: string) => job(`migrate:${t}`),
    ensurePartitions: (t: string, d: number) => job(`partitions:${t}:${String(d)}`),
    analyze: (table: string, t: string) => job(`analyze:${table}:${t}`),
    check: (t: string) => job(`check:${t}`),
  } as unknown as DatabaseService;
  const log = { info: () => undefined, warn: () => undefined, error: (_o: object, m: string) => void errors.push(m) };
  const policy = createAccessPolicy({ allowCidr: OWNER, trustedProxyCidr: "127.0.0.1/32", host: "db.example.test", warn: () => undefined });
  let s: { server: http.Server; port: number };
  let open: { server: http.Server; port: number };
  beforeAll(async () => {
    s = await listen(interfaceHandler({ svc, policy, auth: { tokenSha256: createHash("sha256").update(TOKEN).digest("hex"), sessionSecret: SECRET }, log }));
    open = await listen(interfaceHandler({ svc, policy, auth: null, log }));
  });
  afterAll(() => {
    s.server.close();
    open.server.close();
  });

  const as = (from: string, extra: Record<string, string> = {}): Record<string, string> => ({ host: "db.example.test", "x-forwarded-for": from, ...extra });
  const post = (path: string, body: Record<string, string> | string, extra: Record<string, string> = {}, port = s.port): Promise<Res> =>
    request(port, { method: "POST", path, headers: as(OWNER, { origin: "https://db.example.test", "content-type": "application/x-www-form-urlencoded", ...extra }), body: typeof body === "string" ? body : new URLSearchParams(body).toString() });
  const field = (html: string, name: string): string => new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";
  const signIn = async (): Promise<string> => String((await post("/login", { token: TOKEN })).headers["set-cookie"]?.[0]).split(";")[0] ?? "";
  const confirmed = async (cookie: string, action: string, subject?: string): Promise<Record<string, string>> => {
    const q = subject === undefined ? `action=${action}` : `action=${action}&subject=${subject}`;
    const page = await request(s.port, { path: `/confirm?${q}`, headers: as(OWNER, { cookie }) });
    expect(page.status).toBe(200);
    return { action: field(page.body, "action"), subject: field(page.body, "subject"), csrf: field(page.body, "csrf"), confirm: field(page.body, "confirm") };
  };

  it("serves the stylesheet, and the page with diagnostics and pending files", async () => {
    const css = await request(s.port, { path: "/style.css", headers: as(OWNER) });
    expect([css.status, css.headers["content-type"]]).toEqual([200, "text/css; charset=utf-8"]);
    expect((await request(s.port, { headers: as(OWNER) })).body).toContain("Pending: 0002_b.sql");
    const json = JSON.parse((await request(s.port, { path: "/api/status.json", headers: as(OWNER) })).body) as { snapshot: { schema: { pending: string[] } }; error: null };
    expect([json.snapshot.schema.pending, json.error]).toEqual([["0002_b.sql"], null]);
  });

  it("reports a schema it could not read as null in the JSON", async () => {
    state = { ...state, snapshot: () => ({ ...snap(1), schema: null }) };
    try {
      expect(JSON.parse((await request(s.port, { path: "/api/status.json", headers: as(OWNER) })).body)).toMatchObject({ snapshot: { schema: null } });
    } finally {
      state = { ...state, snapshot: () => snap(1) };
    }
  });

  it("answers 500 and logs when rendering fails, rather than hanging", async () => {
    state = { ...state, snapshot: () => { throw new Error("boom"); } };
    try {
      expect((await request(s.port, { headers: as(OWNER) })).status).toBe(500);
      expect(errors).toContain("interface request failed");
    } finally {
      state = { ...state, snapshot: () => snap(1) };
    }
  });

  it("refuses every POST when actions are not configured, and offers no sign-in", async () => {
    expect((await post("/login", { token: TOKEN }, {}, open.port)).status).toBe(403);
    expect((await request(open.port, { headers: as(OWNER) })).body).not.toContain('action="/login"');
  });

  it("refuses a body above 4 KiB", async () => {
    const status = await post("/login", `token=${"a".repeat(5000)}`).then((r) => r.status, () => "reset");
    expect([400, "reset"]).toContain(status);
  });

  it("survives a client that goes away in the middle of its body", async () => {
    await new Promise<void>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: s.port, method: "POST", path: "/login", headers: as(OWNER, { origin: "https://db.example.test", "content-type": "application/x-www-form-urlencoded", "content-length": "1000" }) });
      req.on("error", () => resolve());
      req.write("token=abc");
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 20);
    });
    expect((await request(s.port, { path: "/style.css", headers: as(OWNER) })).status).toBe(200);
  });

  it("starts migrate, partitions and check, takes a missing subject as '-', and a failed job does not break the page", async () => {
    const cookie = await signIn();
    started.length = 0;
    state.jobFails = true;
    try {
      for (const [action, subject] of [["migrate", undefined], ["partitions", "12"], ["check", "%20"]] as const) {
        const form = await confirmed(cookie, action, subject);
        expect((await post("/action", form, { cookie })).status).toBe(303);
      }
    } finally {
      state.jobFails = false;
    }
    expect(started).toEqual(["migrate:owner", "partitions:owner:12", "check:owner"]);
    expect((await request(s.port, { headers: as(OWNER, { cookie }) })).body).toContain("check  started");
  });

  it("refuses a POST to an unknown path, and an action outside the list, once signed in", async () => {
    const cookie = await signIn();
    const form = await confirmed(cookie, "check");
    expect((await post("/elsewhere", form, { cookie })).status).toBe(404);
    expect((await post("/action", { ...form, action: "vacuum" }, { cookie })).status).toBe(400);
  });

  it("answers 429 once an address has failed too often", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await post("/login", { token: "wrong-token-0123456789" })).status);
    expect(statuses.slice(0, 5)).toEqual([403, 403, 403, 403, 403]);
    expect(statuses.at(-1)).toBe(429);
  });
});

