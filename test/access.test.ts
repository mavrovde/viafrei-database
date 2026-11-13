import { describe, expect, it } from "vitest";
import { addressAllowed, AllowListError, clientAddress, createAccessPolicy, DENIAL_LOG_WINDOW_MS, hostAccepted, parseAddress, parseAllowCidr } from "../src/server/access.js";

const proxies = parseAllowCidr("192.0.2.0/25", "P");
const text = (a: ReturnType<typeof parseAddress>): string | null => (a === null ? null : a.family === 4 ? [...a.bytes].join(".") : "v6");

describe("parseAllowCidr", () => {
  it("reads v4 and v6 entries and bare addresses", () => {
    const r = parseAllowCidr("203.0.113.7, 198.51.100.0/24,2001:db8::/32", "K");
    expect(r.map((x) => [x.family, x.prefix])).toEqual([
      [4, 32],
      [4, 24],
      [6, 32],
    ]);
  });
  it("is empty for an empty value", () => expect(parseAllowCidr("", "K")).toEqual([]));
  it.each(["300.1.1.1", "192.0.2.4/33", "nonsense", "192.0.2.4/x"])("refuses %s naming the key", (v) => {
    expect(() => parseAllowCidr(v, "DB_ALLOW_CIDR")).toThrow(AllowListError);
    expect(() => parseAllowCidr(v, "DB_ALLOW_CIDR")).toThrow(/DB_ALLOW_CIDR/);
  });
});

describe("addressAllowed", () => {
  const rules = parseAllowCidr("203.0.113.0/24", "K");
  it("matches inside the prefix only, and never a null address", () => {
    expect(addressAllowed(rules, parseAddress("203.0.113.200"))).toBe(true);
    expect(addressAllowed(rules, parseAddress("203.0.114.1"))).toBe(false);
    expect(addressAllowed(rules, null)).toBe(false);
  });
  it("reads an IPv4-mapped IPv6 peer as IPv4", () => {
    expect(addressAllowed(rules, parseAddress("::ffff:203.0.113.9"))).toBe(true);
  });
});

describe("clientAddress", () => {
  it("is the peer when the peer is no trusted proxy, whatever X-Forwarded-For says", () => {
    expect(text(clientAddress({ peer: "198.51.100.1", forwardedFor: "203.0.113.7", trustedProxies: proxies }))).toBe("198.51.100.1");
  });
  it("is the rightmost hop that is not a proxy when the peer is one (a forged left hop is ignored)", () => {
    expect(text(clientAddress({ peer: "192.0.2.5", forwardedFor: "203.0.113.7, 198.51.100.9, 192.0.2.6", trustedProxies: proxies }))).toBe("198.51.100.9");
  });
  it("is the peer when a proxy sent no header", () => {
    expect(text(clientAddress({ peer: "192.0.2.5", forwardedFor: undefined, trustedProxies: proxies }))).toBe("192.0.2.5");
  });
  it("is nothing when the hop it would trust is not an address", () => {
    expect(clientAddress({ peer: "192.0.2.5", forwardedFor: "garbage", trustedProxies: proxies })).toBeNull();
  });
});

describe("hostAccepted", () => {
  it("accepts the own name with or without a port, any case, and loopback names", () => {
    for (const h of ["db.example.test", "DB.example.test:443", "localhost:8090", "127.0.0.1", "[::1]:8090"]) expect(hostAccepted(h, "db.example.test")).toBe(true);
  });
  it("refuses another name, an empty and a missing header", () => {
    for (const h of ["other.example.org", "db.example.test.evil", "", undefined]) expect(hostAccepted(h, "db.example.test")).toBe(false);
  });
});

describe("createAccessPolicy", () => {
  const warns: string[] = [];
  const warn = (_f: Record<string, unknown>, m: string): void => void warns.push(m);

  it("decides the allow-list first (over the edge's verified address), then the host", () => {
    const p = createAccessPolicy({ allowCidr: "203.0.113.7", trustedProxyCidr: "192.0.2.0/25", host: "db.example.test", warn });
    expect(p.decide({ peer: "192.0.2.5", forwardedFor: "203.0.113.7", host: "db.example.test" })).toBe("allowed");
    expect(p.decide({ peer: "192.0.2.5", forwardedFor: "198.51.100.1", host: "db.example.test" })).toBe("allow-list");
    expect(p.decide({ peer: "192.0.2.5", forwardedFor: "203.0.113.7", host: "other.example" })).toBe("host");
    expect(p.decide({ peer: "198.51.100.1", forwardedFor: "203.0.113.7", host: "db.example.test" })).toBe("allow-list");
    // An outsider with a wrong Host is refused by the allow-list: no 421 tells them the name.
    expect(p.decide({ peer: "192.0.2.5", forwardedFor: "198.51.100.1", host: "other.example" })).toBe("allow-list");
  });

  it("denies everything with an empty allow-list, and says so at start", () => {
    warns.length = 0;
    const p = createAccessPolicy({ allowCidr: "", trustedProxyCidr: "", host: "db.example.test", warn });
    expect(p.decide({ peer: "127.0.0.1", forwardedFor: undefined, host: "localhost" })).toBe("allow-list");
    expect(warns[0]).toContain("denies ALL");
  });

  it("refuses an allow-list entry overlapping a proxy range", () => {
    expect(() => createAccessPolicy({ allowCidr: "192.0.2.64/26", trustedProxyCidr: "192.0.2.0/25", host: "h", warn })).toThrow(/overlaps/);
  });

  it("logs one denial line per reason per minute, counting the rest", () => {
    const lines: Record<string, unknown>[] = [];
    let t = 0;
    const p = createAccessPolicy({ allowCidr: "", trustedProxyCidr: "", host: "h", warn: (f) => void lines.push(f), now: () => t });
    lines.length = 0;
    p.recordDenial("allow-list");
    p.recordDenial("allow-list");
    p.recordDenial("host");
    t = DENIAL_LOG_WINDOW_MS;
    p.recordDenial("allow-list");
    expect(lines).toEqual([
      { reason: "allow-list", suppressedSincePrevious: 0 },
      { reason: "host", suppressedSincePrevious: 0 },
      { reason: "allow-list", suppressedSincePrevious: 1 },
    ]);
  });
});

describe("parseAddress, address by address", () => {
  const v6 = (a: ReturnType<typeof parseAddress>): string | null => (a === null ? null : `${String(a.family)}:${Buffer.from(a.bytes).toString("hex")}`);
  it.each<[string | null | undefined, string | null]>([
    [null, null],
    [undefined, null],
    ["   ", null],
    ["2001:db8::1", "6:20010db8000000000000000000000001"],
    ["[2001:db8::1]", "6:20010db8000000000000000000000001"],
    ["fe80::1%eth0", "6:fe800000000000000000000000000001"],
    ["::", "6:00000000000000000000000000000000"],
    ["::1", "6:00000000000000000000000000000001"],
    ["2001:db8::", "6:20010db8000000000000000000000000"],
    ["1:2:3:4:5:6:7:8", "6:00010002000300040005000600070008"],
    ["1:2:3:4:5:6:7", null],
    ["1:2:3:4:5:6:7:8:9", null],
    ["1::2::3", null],
    ["1:2:3:4::5:6:7:8", null],
    ["2001:db8::12345", null],
    ["2001:db8::g", null],
    ["::ffff:300.1.1.1", null],
    ["64:ff9b::192.0.2.1", "6:0064ff9b0000000000000000c0000201"],
    ["::fffe:192.0.2.1", "6:00000000000000000000fffec0000201"],
    ["1::ffff:192.0.2.1", "6:00010000000000000000ffffc0000201"],
    ["::ffff:192.0.2.1", "4:c0000201"],
    ["01.2.3.4", null],
  ])("%j is %j", (raw, want) => {
    expect(v6(parseAddress(raw))).toBe(want);
  });
});

describe("parseAllowCidr's refusals", () => {
  it.each<[string, RegExp]>([
    ["203.0.113.7,", /empty entry/],
    ["fe80::1%eth0/128", /zone index/],
    ["0.0.0.0/0", /prefix \/0/],
    ["0.0.0.0/8", /all-zero network/],
    ["2001:db8::/129", /above \/128/],
    ["192.0.2.1/24", /sets bits below its prefix/],
    ["2001:db8::1/64", /sets bits below its prefix/],
  ])("%s", (v, re) => {
    expect(() => parseAllowCidr(v, "K")).toThrow(re);
  });
  it("matches a prefix that is not a whole byte", () => {
    const r = parseAllowCidr("192.0.2.0/25", "K");
    expect([addressAllowed(r, parseAddress("192.0.2.127")), addressAllowed(r, parseAddress("192.0.2.128"))]).toEqual([true, false]);
  });
});

describe("clientAddress and hostAccepted at their edges", () => {
  it("reads a header sent twice as one list", () => {
    expect(text(clientAddress({ peer: "192.0.2.5", forwardedFor: ["203.0.113.7", "192.0.2.6"], trustedProxies: proxies }))).toBe("203.0.113.7");
  });
  it("is the leftmost hop when every hop is a trusted proxy", () => {
    expect(text(clientAddress({ peer: "192.0.2.5", forwardedFor: "192.0.2.7, 192.0.2.6", trustedProxies: proxies }))).toBe("192.0.2.7");
  });
  it.each<[string, boolean]>([
    ["[::1]:8090", true],
    ["[::1", false],
    ["[2001:db8::1]", false],
  ])("Host %j is %s", (h, ok) => {
    expect(hostAccepted(h, "db.example.org")).toBe(ok);
  });
});

