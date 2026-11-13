/**
 * Who may reach the interface (the host named by DB_HOST): the CIDR
 * allow-list, the `X-Forwarded-For` trust rule and the `Host` check, by four
 * rules:
 *
 * 1. Deny by default: an empty `DB_ALLOW_CIDR` denies every request.
 * 2. A malformed entry is refused at boot, naming that entry only.
 * 3. `X-Forwarded-For` is believed only from a peer inside
 *    `DB_TRUSTED_PROXY_CIDR` (the network your reverse proxy arrives from), walked
 *    from the right: the client is the rightmost hop that is not itself a
 *    trusted proxy. From any other peer the header is ignored.
 * 4. A denial says nothing: 403, empty body, and a rate-limited log line that
 *    carries the outcome and never an address.
 *
 * This is the second of two layers: run the interface behind a reverse proxy
 * or ingress that carries the same allow-list and refuses before a request
 * reaches the container (docs/deployment.md).
 * The readiness port is not behind this policy and is never routed by the edge.
 * Pure below `createAccessPolicy`, so the rules are unit tests.
 */
export type CidrRule = { readonly text: string; readonly family: 4 | 6; readonly bytes: Uint8Array; readonly prefix: number };
export type IpAddress = { readonly family: 4 | 6; readonly bytes: Uint8Array };

export class AllowListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowListError";
  }
}

function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const part = parts[i] ?? "";
    // A leading zero is octal to some parsers and decimal to others; refused.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

function parseIpv6(text: string): Uint8Array | null {
  if (!text.includes(":")) return null;
  let source = text;
  const lastColon = source.lastIndexOf(":");
  const tail = source.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    const g1 = (((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16);
    const g2 = (((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16);
    source = `${source.slice(0, lastColon + 1)}${g1}:${g2}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = (halves[0] ?? "") === "" ? [] : (halves[0] ?? "").split(":");
  const right = halves.length === 2 ? ((halves[1] ?? "") === "" ? [] : (halves[1] ?? "").split(":")) : [];
  let groups: string[];
  if (halves.length === 1) {
    if (left.length !== 8) return null;
    groups = left;
  } else {
    if (left.length + right.length > 7) return null;
    groups = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const g = groups[i] ?? "";
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const n = parseInt(g, 16);
    bytes[i * 2] = n >> 8;
    bytes[i * 2 + 1] = n & 0xff;
  }
  return bytes;
}

function mappedV4(bytes: Uint8Array): Uint8Array | null {
  for (let i = 0; i < 10; i += 1) if (bytes[i] !== 0) return null;
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return bytes.slice(12, 16);
}

/** IPv4-mapped IPv6 becomes IPv4, a zone index is dropped, brackets are allowed. null = not an address. */
export function parseAddress(raw: string | null | undefined): IpAddress | null {
  if (raw === null || raw === undefined) return null;
  let text = raw.trim();
  if (text === "") return null;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const percent = text.indexOf("%");
  if (percent !== -1) text = text.slice(0, percent);
  const v4 = parseIpv4(text);
  if (v4 !== null) return { family: 4, bytes: v4 };
  const v6 = parseIpv6(text);
  if (v6 === null) return null;
  const mapped = mappedV4(v6);
  return mapped === null ? { family: 6, bytes: v6 } : { family: 4, bytes: mapped };
}

function maskedEqual(a: Uint8Array, b: Uint8Array, prefix: number): boolean {
  const whole = prefix >> 3;
  for (let i = 0; i < whole; i += 1) if (a[i] !== b[i]) return false;
  const rest = prefix & 7;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return ((a[whole] ?? 0) & mask) === ((b[whole] ?? 0) & mask);
}

/** Comma-separated entries; a bare address is a host route; everything malformed throws, naming the entry. */
export function parseAllowCidr(raw: string | null | undefined, key: string): CidrRule[] {
  const text = (raw ?? "").trim();
  if (text === "") return [];
  return text.split(",").map((entry): CidrRule => {
    const item = entry.trim();
    if (item === "") throw new AllowListError(`${key} has an empty entry (a stray comma) — a typo must not decide who may read this page.`);
    const slash = item.lastIndexOf("/");
    const addressText = slash === -1 ? item : item.slice(0, slash);
    const prefixText = slash === -1 ? null : item.slice(slash + 1);
    if (addressText.includes("%")) throw new AllowListError(`${key} entry ${JSON.stringify(item)} carries a zone index; write the address without it.`);
    const address = parseAddress(addressText);
    if (address === null) throw new AllowListError(`${key} entry ${JSON.stringify(item)} is not an IPv4 or IPv6 address.`);
    const width = address.family === 4 ? 32 : 128;
    let prefix = width;
    if (prefixText !== null) {
      if (!/^(0|[1-9]\d{0,2})$/.test(prefixText)) throw new AllowListError(`${key} entry ${JSON.stringify(item)} has a prefix length that is not a plain number.`);
      prefix = Number(prefixText);
      if (prefix === 0) throw new AllowListError(`${key} entry ${JSON.stringify(item)} has prefix /0, which matches every address — that is not an allow-list.`);
      if (prefix > width) throw new AllowListError(`${key} entry ${JSON.stringify(item)} has a prefix length above /${String(width)}.`);
    }
    if (address.bytes.every((b) => b === 0)) throw new AllowListError(`${key} entry ${JSON.stringify(item)} is the all-zero network.`);
    for (let bit = prefix; bit < width; bit += 1) {
      if (((address.bytes[bit >> 3] ?? 0) >> (7 - (bit & 7))) & 1) {
        throw new AllowListError(`${key} entry ${JSON.stringify(item)} sets bits below its prefix; write the host route or the network address itself.`);
      }
    }
    return { text: item, family: address.family, bytes: address.bytes, prefix };
  });
}

export function addressAllowed(rules: readonly CidrRule[], address: IpAddress | null): boolean {
  if (address === null) return false;
  return rules.some((r) => r.family === address.family && maskedEqual(r.bytes, address.bytes, r.prefix));
}

/** The socket peer, or — when the peer is a trusted proxy — the rightmost X-Forwarded-For hop that is not one. */
export function clientAddress(input: { peer: string | null | undefined; forwardedFor: string | string[] | undefined; trustedProxies: readonly CidrRule[] }): IpAddress | null {
  const peer = parseAddress(input.peer);
  if (!addressAllowed(input.trustedProxies, peer)) return peer;
  const header = Array.isArray(input.forwardedFor) ? input.forwardedFor.join(",") : input.forwardedFor;
  const hops = (header ?? "").split(",").map((h) => h.trim()).filter((h) => h !== "");
  if (hops.length === 0) return peer;
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = parseAddress(hops[i]);
    if (hop === null) return null;
    if (i === 0 || !addressAllowed(input.trustedProxies, hop)) return hop;
  }
  // The loop returns at i === 0 at the latest (hops is not empty here); this line only satisfies the return type.
  /* v8 ignore next */
  return null;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function hostNameOf(hostHeader: string | undefined): string | null {
  if (hostHeader === undefined) return null;
  let name = hostHeader.trim().toLowerCase();
  if (name === "") return null;
  if (name.startsWith("[")) {
    const close = name.indexOf("]");
    if (close === -1) return null;
    name = name.slice(0, close + 1);
  } else {
    const colon = name.indexOf(":");
    if (colon !== -1) name = name.slice(0, colon);
  }
  return name;
}

/** `Host` must be the interface's own name or a loopback name; anything else is refused. */
export function hostAccepted(hostHeader: string | undefined, ownHost: string): boolean {
  const name = hostNameOf(hostHeader);
  if (name === null) return false;
  return LOOPBACK_HOSTS.has(name) || name === ownHost.trim().toLowerCase();
}

export type AccessPolicy = {
  readonly rules: readonly CidrRule[];
  readonly trustedProxies: readonly CidrRule[];
  readonly host: string;
  /** "allowed", or the outcome a denial is logged as. */
  readonly decide: (req: { peer: string | undefined; forwardedFor: string | string[] | undefined; host: string | undefined }) => "allowed" | "allow-list" | "host";
  readonly recordDenial: (reason: "allow-list" | "host") => void;
};

export const DENIAL_LOG_WINDOW_MS = 60_000;

export function createAccessPolicy(input: {
  allowCidr: string | undefined;
  trustedProxyCidr: string | undefined;
  host: string;
  warn: (fields: Record<string, unknown>, message: string) => void;
  now?: () => number;
}): AccessPolicy {
  const rules = parseAllowCidr(input.allowCidr, "DB_ALLOW_CIDR");
  const trustedProxies = parseAllowCidr(input.trustedProxyCidr, "DB_TRUSTED_PROXY_CIDR");
  for (const allow of rules) {
    if (trustedProxies.some((p) => p.family === allow.family && maskedEqual(p.bytes, allow.bytes, Math.min(p.prefix, allow.prefix)))) {
      throw new AllowListError(`DB_ALLOW_CIDR entry ${JSON.stringify(allow.text)} overlaps a DB_TRUSTED_PROXY_CIDR entry — a proxy range belongs in DB_TRUSTED_PROXY_CIDR only.`);
    }
  }
  if (rules.length === 0) input.warn({ rules: 0 }, "DB_ALLOW_CIDR is empty: the interface denies ALL requests with 403");
  else input.warn({ rules: rules.length, trustedProxies: trustedProxies.length }, "interface access control armed");
  const now = input.now ?? ((): number => Date.now());
  const windows = new Map<string, { start: number; suppressed: number }>();
  const recordDenial = (reason: "allow-list" | "host"): void => {
    const t = now();
    const w = windows.get(reason) ?? { start: Number.NEGATIVE_INFINITY, suppressed: 0 };
    windows.set(reason, w);
    if (t - w.start >= DENIAL_LOG_WINDOW_MS) {
      input.warn({ reason, suppressedSincePrevious: w.suppressed }, "interface refused a request");
      w.start = t;
      w.suppressed = 0;
    } else w.suppressed += 1;
  };
  // The allow-list first: an outsider learns nothing, not even which Host
  // name this interface answers to (a 421 would tell them it exists).
  const decide: AccessPolicy["decide"] = (req) => {
    const client = clientAddress({ peer: req.peer, forwardedFor: req.forwardedFor, trustedProxies });
    if (!addressAllowed(rules, client)) return "allow-list";
    return hostAccepted(req.host, input.host) ? "allowed" : "host";
  };
  return { rules, trustedProxies, host: input.host, decide, recordDenial };
}
