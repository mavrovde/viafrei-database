/**
 * The owner sign-in for the interface's ACTIONS, token-based:
 *
 *   * The token is never stored: the deployment holds DB_OWNER_TOKEN_SHA256,
 *     the SHA-256 of a random token only the owner knows; a sign-in compares
 *     digests in constant time. Unset = actions are switched off (diagnostics
 *     still served).
 *   * The session is a signed cookie, `__Host-vf_db`: Secure, HttpOnly,
 *     SameSite=Strict, Path=/, no Domain; eight hours; HMAC-SHA256 under
 *     DB_SESSION_SECRET. The signature alone does not keep it alive: the
 *     process remembers the sessions it issued (SessionRegistry), so signing
 *     out revokes the cookie server-side, and a restart signs everyone out.
 *     That memory is per process, which is why the interface runs one replica.
 *   * Every POST needs an Origin naming the interface host, a CSRF token bound
 *     to the session, and — for an action — a confirmation token bound to the
 *     action and its subject, minted on the confirm page, valid two minutes and
 *     usable ONCE.
 *   * Sign-in failures are rate-limited: five per address and twenty overall per
 *     fifteen minutes.
 *
 * Passkeys are deliberately not here yet: they need a script on the page and a
 * credential table, and the interface's actions are all safe and idempotent.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "__Host-vf_db";
export const SESSION_TTL_MS = 8 * 3_600_000;
export const CONFIRM_TTL_MS = 120_000;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_FAILURES_PER_ADDRESS = 5;
export const LOGIN_FAILURES_OVERALL = 20;

export type OwnerAuth = { readonly tokenSha256: string; readonly sessionSecret: string } | null;

const b64url = (b: Buffer): string => b.toString("base64url");
const hmac = (secret: string, text: string): string => b64url(createHmac("sha256", secret).update(text).digest());

function equalText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function tokenMatches(token: string, digestHex: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(digestHex) || token.length < 16 || token.length > 512) return false;
  return timingSafeEqual(createHash("sha256").update(token, "utf8").digest(), Buffer.from(digestHex, "hex"));
}

export function mintSession(secret: string, now: Date, random: () => Buffer = () => randomBytes(18)): string {
  const body = `v1.${String(now.getTime() + SESSION_TTL_MS)}.${b64url(random())}`;
  return `${body}.${hmac(secret, body)}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i >= 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The session's random part when the cookie is ours, unexpired and unforged; else null. */
export function verifySession(cookieHeader: string | undefined, secret: string, now: Date): string | null {
  const raw = readCookie(cookieHeader, SESSION_COOKIE);
  if (raw === null) return null;
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [v, exp, rand, mac] = parts as [string, string, string, string];
  if (!/^\d{13}$/.test(exp) || !/^[A-Za-z0-9_-]{16,64}$/.test(rand)) return null;
  if (!equalText(mac, hmac(secret, `${v}.${exp}.${rand}`))) return null;
  if (Number(exp) <= now.getTime()) return null;
  return rand;
}

export const sessionCookie = (value: string): string => `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${String(SESSION_TTL_MS / 1000)}`;
export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;

export const csrfToken = (secret: string, rand: string): string => hmac(secret, `csrf.${rand}`);
export const csrfMatches = (secret: string, rand: string, given: unknown): boolean => typeof given === "string" && equalText(given, csrfToken(secret, rand));

export function mintConfirm(secret: string, rand: string, action: string, subject: string, now: Date): string {
  const exp = String(now.getTime() + CONFIRM_TTL_MS);
  return `${exp}.${hmac(secret, `confirm.${rand}.${action}.${subject}.${exp}`)}`;
}

export function confirmMatches(secret: string, rand: string, action: string, subject: string, given: unknown, now: Date): boolean {
  if (typeof given !== "string") return false;
  const dot = given.indexOf(".");
  if (dot < 0) return false;
  const exp = given.slice(0, dot);
  if (!/^\d{13}$/.test(exp) || Number(exp) <= now.getTime()) return false;
  return equalText(given.slice(dot + 1), hmac(secret, `confirm.${rand}.${action}.${subject}.${exp}`));
}

/** At most this many live sessions; the oldest is dropped (signed out) past it. */
export const SESSION_LIMIT = 16;

/**
 * The sessions this process issued and has not revoked, by their random part.
 * A cookie with a valid signature that is not here (signed out, or issued
 * before a restart) is no session.
 */
export class SessionRegistry {
  private readonly live = new Map<string, number>();
  /** Mint a session, remember it, and return the cookie value. */
  issue(secret: string, now: Date, random: () => Buffer = () => randomBytes(18)): string {
    const value = mintSession(secret, now, random);
    const [, exp, rand] = value.split(".") as [string, string, string, string];
    this.prune(now);
    this.live.set(rand, Number(exp));
    while (this.live.size > SESSION_LIMIT) {
      const oldest = this.live.keys().next().value;
      // The map holds more than SESSION_LIMIT entries here, so a first key exists; the guard only narrows the type.
      /* v8 ignore next */
      if (oldest === undefined) break;
      this.live.delete(oldest);
    }
    return value;
  }
  has(rand: string, now: Date): boolean {
    const exp = this.live.get(rand);
    return exp !== undefined && exp > now.getTime();
  }
  revoke(rand: string): void {
    this.live.delete(rand);
  }
  get size(): number {
    return this.live.size;
  }
  private prune(now: Date): void {
    for (const [k, exp] of this.live) if (exp <= now.getTime()) this.live.delete(k);
  }
}

/** A confirmation is usable once: consumed on use, forgotten after it expires. */
export class ConfirmLedger {
  private readonly used = new Map<string, number>();
  consume(token: string, now: Date): boolean {
    for (const [k, exp] of this.used) if (exp <= now.getTime()) this.used.delete(k);
    if (this.used.has(token)) return false;
    this.used.set(token, now.getTime() + CONFIRM_TTL_MS);
    return true;
  }
}

/** A POST must come from a page of the interface itself (https, own host); a loopback Origin only when the host is loopback. */
export function originAllowed(origin: string | undefined, ownHost: string): boolean {
  if (origin === undefined || origin === "null") return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const own = ownHost.trim().toLowerCase();
  if (host === own && u.protocol === "https:") return true;
  const loop = (h: string): boolean => h === "localhost" || h === "127.0.0.1" || h === "::1";
  return loop(own) && loop(host) && (u.protocol === "http:" || u.protocol === "https:");
}

/** Sign-in failures per address and overall, in a sliding window. The address is a key in memory, never logged. */
export class LoginLimiter {
  private readonly perAddress = new Map<string, number[]>();
  private overall: number[] = [];
  constructor(private readonly perAddressMax = LOGIN_FAILURES_PER_ADDRESS, private readonly overallMax = LOGIN_FAILURES_OVERALL, private readonly windowMs = LOGIN_WINDOW_MS) {}
  private prune(now: number): void {
    this.overall = this.overall.filter((t) => now - t < this.windowMs);
    for (const [k, v] of this.perAddress) {
      const kept = v.filter((t) => now - t < this.windowMs);
      if (kept.length === 0) this.perAddress.delete(k);
      else this.perAddress.set(k, kept);
    }
  }
  blocked(address: string, now: number): boolean {
    this.prune(now);
    return this.overall.length >= this.overallMax || (this.perAddress.get(address)?.length ?? 0) >= this.perAddressMax;
  }
  fail(address: string, now: number): void {
    this.overall.push(now);
    this.perAddress.set(address, [...(this.perAddress.get(address) ?? []), now]);
  }
}
