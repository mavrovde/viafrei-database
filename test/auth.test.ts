import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONFIRM_TTL_MS,
  ConfirmLedger,
  confirmMatches,
  csrfMatches,
  csrfToken,
  LoginLimiter,
  LOGIN_WINDOW_MS,
  mintConfirm,
  mintSession,
  originAllowed,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookie,
  SESSION_LIMIT,
  SessionRegistry,
  tokenMatches,
  verifySession,
} from "../src/server/auth.js";

const SECRET = "s".repeat(40);
const now = new Date("2026-11-13T12:00:00Z");
const later = (ms: number): Date => new Date(now.getTime() + ms);
const fixed = (): Buffer => Buffer.alloc(18, 7);

describe("tokenMatches", () => {
  const token = "owner-token-0123456789";
  const digest = createHash("sha256").update(token).digest("hex");
  it("accepts the token whose sha256 is configured, and nothing else", () => {
    expect(tokenMatches(token, digest)).toBe(true);
    expect(tokenMatches(`${token}x`, digest)).toBe(false);
  });
  it("refuses a short token and a malformed digest outright", () => {
    expect(tokenMatches("short", createHash("sha256").update("short").digest("hex"))).toBe(false);
    expect(tokenMatches(token, digest.toUpperCase())).toBe(false);
  });
});

describe("sessions", () => {
  const cookie = (v: string): string => `other=1; ${SESSION_COOKIE}=${v}`;
  it("verify a minted session until it expires, returning its random part", () => {
    const s = mintSession(SECRET, now, fixed);
    expect(verifySession(cookie(s), SECRET, later(SESSION_TTL_MS - 1))).toBe(fixed().toString("base64url"));
    expect(verifySession(cookie(s), SECRET, later(SESSION_TTL_MS))).toBeNull();
  });
  it("refuse another secret, a tampered expiry and garbage", () => {
    const s = mintSession(SECRET, now, fixed);
    expect(verifySession(cookie(s), "t".repeat(40), now)).toBeNull();
    const [v, exp, rand, mac] = s.split(".");
    expect(verifySession(cookie(`${v ?? ""}.${String(Number(exp) + 1000)}.${rand ?? ""}.${mac ?? ""}`), SECRET, now)).toBeNull();
    expect(verifySession(cookie("v1.x.y.z"), SECRET, now)).toBeNull();
    expect(verifySession(undefined, SECRET, now)).toBeNull();
  });
  it("set a __Host- cookie that is Secure, HttpOnly, SameSite=Strict and path /", () => {
    expect(sessionCookie("v")).toMatch(/^__Host-vf_db=v; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800$/);
  });
  it("read a cookie by exact name only", () => {
    expect(readCookie("a=1; x__Host-vf_db=2", SESSION_COOKIE)).toBeNull();
    expect(readCookie("a=1;__Host-vf_db=2", SESSION_COOKIE)).toBe("2");
  });
});

describe("CSRF and confirmation", () => {
  it("bind the CSRF token to the session", () => {
    expect(csrfMatches(SECRET, "r1", csrfToken(SECRET, "r1"))).toBe(true);
    expect(csrfMatches(SECRET, "r2", csrfToken(SECRET, "r1"))).toBe(false);
    expect(csrfMatches(SECRET, "r1", undefined)).toBe(false);
  });
  it("bind a confirmation to session, action, subject and two minutes", () => {
    const c = mintConfirm(SECRET, "r1", "analyze", "public.trips", now);
    expect(confirmMatches(SECRET, "r1", "analyze", "public.trips", c, later(CONFIRM_TTL_MS - 1))).toBe(true);
    expect(confirmMatches(SECRET, "r1", "analyze", "public.trips", c, later(CONFIRM_TTL_MS))).toBe(false);
    expect(confirmMatches(SECRET, "r1", "analyze", "public.stops", c, now)).toBe(false);
    expect(confirmMatches(SECRET, "r1", "migrate", "public.trips", c, now)).toBe(false);
    expect(confirmMatches(SECRET, "r2", "analyze", "public.trips", c, now)).toBe(false);
    expect(confirmMatches(SECRET, "r1", "analyze", "public.trips", "nodot", now)).toBe(false);
  });
  it("are usable once", () => {
    const l = new ConfirmLedger();
    expect(l.consume("c", now)).toBe(true);
    expect(l.consume("c", now)).toBe(false);
    expect(l.consume("c", later(CONFIRM_TTL_MS))).toBe(true);
  });
});

describe("originAllowed", () => {
  it("accepts only https on the own host, or loopback for a loopback host", () => {
    expect(originAllowed("https://db.example.test", "db.example.test")).toBe(true);
    expect(originAllowed("http://db.example.test", "db.example.test")).toBe(false);
    expect(originAllowed("https://evil.example", "db.example.test")).toBe(false);
    expect(originAllowed("http://localhost:8090", "db.example.test")).toBe(false);
    expect(originAllowed("http://localhost:8090", "localhost")).toBe(true);
    expect(originAllowed("null", "db.example.test")).toBe(false);
    expect(originAllowed(undefined, "db.example.test")).toBe(false);
    expect(originAllowed("::::", "db.example.test")).toBe(false);
  });
});

describe("LoginLimiter", () => {
  it("blocks an address after its failures, and everyone after the overall limit, for the window", () => {
    const l = new LoginLimiter(2, 3, LOGIN_WINDOW_MS);
    l.fail("a", 0);
    expect(l.blocked("a", 1)).toBe(false);
    l.fail("a", 1);
    expect(l.blocked("a", 2)).toBe(true);
    expect(l.blocked("b", 2)).toBe(false);
    l.fail("b", 2);
    expect(l.blocked("c", 3)).toBe(true);
    expect(l.blocked("a", LOGIN_WINDOW_MS + 2)).toBe(false);
  });
});

describe("SessionRegistry", () => {
  const rand = (v: string): string => v.split(".")[2] ?? "";
  it("knows a session it issued until it expires or is revoked", () => {
    const r = new SessionRegistry();
    const v = r.issue(SECRET, now, fixed);
    expect(verifySession(`${SESSION_COOKIE}=${v}`, SECRET, now)).toBe(rand(v));
    expect(r.has(rand(v), later(SESSION_TTL_MS - 1))).toBe(true);
    expect(r.has(rand(v), later(SESSION_TTL_MS))).toBe(false);
    r.revoke(rand(v));
    expect(r.has(rand(v), now)).toBe(false);
  });
  it("does not know a validly signed session another process (or a restart) issued", () => {
    expect(new SessionRegistry().has(rand(mintSession(SECRET, now, fixed)), now)).toBe(false);
  });
  it(`keeps at most ${String(SESSION_LIMIT)} sessions, dropping the oldest`, () => {
    const r = new SessionRegistry();
    let n = 0;
    const next = (): Buffer => Buffer.alloc(18, ++n);
    const first = r.issue(SECRET, now, next);
    for (let i = 0; i < SESSION_LIMIT; i += 1) r.issue(SECRET, now, next);
    expect(r.size).toBe(SESSION_LIMIT);
    expect(r.has(rand(first), now)).toBe(false);
  });
  it("forgets expired sessions when it issues a new one", () => {
    const r = new SessionRegistry();
    r.issue(SECRET, now, fixed);
    r.issue(SECRET, later(SESSION_TTL_MS), () => Buffer.alloc(18, 9));
    expect(r.size).toBe(1);
  });
});

describe("the session and confirmation edges", () => {
  it("mints a different random part each time when no random source is given, and verifies it", () => {
    const a = mintSession(SECRET, now);
    const b = mintSession(SECRET, now);
    expect(a).not.toBe(b);
    expect(verifySession(`${SESSION_COOKIE}=${a}`, SECRET, now)).toBe(a.split(".")[2]);
    expect(new SessionRegistry().issue(SECRET, now).split(".")).toHaveLength(4);
  });
  it("refuses a cookie of another version or another shape before it checks the signature", () => {
    const [, exp, rand, mac] = mintSession(SECRET, now, fixed).split(".");
    expect(verifySession(`${SESSION_COOKIE}=v2.${exp ?? ""}.${rand ?? ""}.${mac ?? ""}`, SECRET, now)).toBeNull();
    expect(verifySession(`${SESSION_COOKIE}=v1.${exp ?? ""}.${rand ?? ""}`, SECRET, now)).toBeNull();
  });
  it("refuses a confirmation that is not a string", () => {
    expect(confirmMatches(SECRET, "r", "migrate", "-", undefined, now)).toBe(false);
    expect(confirmMatches(SECRET, "r", "migrate", "-", 12, now)).toBe(false);
  });
});

