import { describe, expect, it } from "vitest";
import { APP_ROOT, ConfigError, loadConfig, schemaDirs } from "../src/config.js";
import type { Diagnostics } from "../src/diagnostics.js";
import { describeFile } from "../src/migrations/files.js";
import { compare, readiness, serviceReadiness } from "../src/migrations/plan.js";
import { bytes, confirmPage, esc, statusPage } from "../src/server/html.js";
import type { Snapshot } from "../src/service.js";

const URL_ = "postgresql://u:pw@h/db";

describe("loadConfig", () => {
  it("needs a postgresql:// DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL: "mysql://x" })).toThrow(/postgresql:\/\//);
  });
  it("takes the deploy's lock retry and 30 days for serve, one attempt and 7 days for the CLI", () => {
    expect(loadConfig({ DATABASE_URL: URL_ }, "serve")).toMatchObject({ lockAttempts: 4, lockPauseS: 20, partitionDays: 30, readyPort: 8080, httpPort: 8090, interfaceHost: null, roleSecretDir: null });
    expect(loadConfig({ DATABASE_URL: URL_ }, "cli")).toMatchObject({ lockAttempts: 1, partitionDays: 7 });
  });
  it.each<[Record<string, string>, RegExp]>([
    [{ DB_MIGRATE_LOCK_ATTEMPTS: "0" }, /between 1 and 100/],
    [{ VF_DB_READY_PORT: "x" }, /whole number/],
    [{ VF_DB_READY_PORT: "8090" }, /must differ/],
    [{ DB_OWNER_TOKEN_SHA256: "a".repeat(64) }, /together or not at all/],
    [{ DB_SESSION_SECRET: "x".repeat(40) }, /together or not at all/],
    [{ DB_OWNER_TOKEN_SHA256: "A".repeat(64), DB_SESSION_SECRET: "x".repeat(40) }, /lower-case hex/],
    [{ DB_OWNER_TOKEN_SHA256: "a".repeat(64), DB_SESSION_SECRET: "short" }, /at least 32/],
    [{ DB_HOST: "db.example.test/evil" }, /host name/],
  ])("refuses %j", (env, re) => {
    expect(() => loadConfig({ DATABASE_URL: URL_, ...env })).toThrow(re);
  });
  it("reads the interface's settings, lower-casing the host", () => {
    expect(loadConfig({ DATABASE_URL: URL_, DB_HOST: "DB.example.test", DB_ALLOW_CIDR: "203.0.113.7", DB_OWNER_TOKEN_SHA256: "a".repeat(64), DB_SESSION_SECRET: "x".repeat(40) })).toMatchObject({
      interfaceHost: "db.example.test",
      allowCidr: "203.0.113.7",
      ownerTokenSha256: "a".repeat(64),
    });
  });
  it("finds the baseline and the migrations under the image's db/ unless the environment says otherwise", () => {
    expect(loadConfig({ DATABASE_URL: URL_ })).toMatchObject({ migrationsDir: `${APP_ROOT}/db/migrations`, baselineDir: `${APP_ROOT}/db/baseline` });
    expect(schemaDirs({ VF_DB_MIGRATIONS_DIR: "/m", VF_DB_BASELINE_DIR: "/b" })).toEqual({ migrationsDir: "/m", baselineDir: "/b" });
    expect(schemaDirs({}, "/r")).toEqual({ migrationsDir: "/r/db/migrations", baselineDir: "/r/db/baseline" });
  });
});

const EVIL = `<script>alert("x")</script>'`;
const f = describeFile("0001_a.sql", Buffer.from("a\n"));
const schema = compare([f], [{ version: 1, checksum: "0".repeat(64) }]);
const sr = readiness(schema);
const snapshot: Snapshot = {
  readiness: serviceReadiness(sr, { partitions: true, roles: true }),
  schema,
  schemaReadiness: sr,
  lastMigrate: null,
  lastAction: { action: "analyze", subject: EVIL, trigger: "owner", startedAt: new Date(0), finishedAt: new Date(0), durationMs: 0, ok: false, exitCode: 1, lines: [EVIL] },
  roles: null,
  busy: null,
  imageHead: 1,
  checkedAt: new Date(0),
};
const diag: Diagnostics = {
  versions: { postgres: EVIL, postgis: null, database: "viafrei", now: new Date(0) },
  sizeBytes: 5 * 1024 ** 3,
  largest: [{ schema: "public", name: EVIL, kind: "p", bytes: 1 }],
  partitions: [],
  connections: [{ role: EVIL, state: "idle", count: 1 }],
  longQueries: [{ pid: 1, role: "r", state: "active", seconds: 40, wait_event_type: null, wait_event: null, query: EVIL }],
  locks: [],
  vacuum: [],
  wraparound: [],
  vacuumRunning: 0,
  ledgerTail: [{ version: 1, name: EVIL, applied_at: new Date(0) }],
};

describe("the pages", () => {
  it("escape every value that reaches them, and carry no script", () => {
    for (const html of [statusPage(snapshot, diag, null, { signedIn: false, enabled: true }, EVIL), statusPage(snapshot, null, EVIL, { signedIn: true, csrf: EVIL }, null), confirmPage("analyze", EVIL, EVIL, EVIL)]) {
      expect(html).not.toContain("<script");
      expect(html).not.toContain(`"x")`);
    }
  });
  it("show the mismatch and NOT READY", () => {
    const html = statusPage(snapshot, diag, null, { signedIn: false, enabled: false }, null);
    expect(html).toContain("NOT READY");
    expect(html).toContain("0".repeat(64));
  });
  it("offer sign-in only when actions are configured, and the action forms only when signed in", () => {
    expect(statusPage(snapshot, diag, null, { signedIn: false, enabled: false }, null)).not.toContain('action="/login"');
    expect(statusPage(snapshot, diag, null, { signedIn: false, enabled: true }, null)).toContain('action="/login"');
    const signed = statusPage(snapshot, diag, null, { signedIn: true, csrf: "c" }, null);
    expect(signed).toContain('action="/logout"');
    expect(signed).not.toContain('action="/login"');
  });
  it("esc and bytes", () => {
    expect(esc(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    expect(bytes(512)).toBe("512 B");
    expect(bytes(1536)).toBe("1.5 kB");
    expect(bytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });
});

describe("the status page with every section filled", () => {
  const full: Diagnostics = {
    ...diag,
    versions: { postgres: "PostgreSQL 16", postgis: "3.4", database: "viafrei", now: new Date(0) },
    partitions: [
      { schema: "public", name: "fuel_prices", partitions: 38, has_default: false, default_rows_estimate: 0, oldest_from: new Date("2026-11-01T00:00:00Z"), newest_to: new Date("2026-11-21T00:00:00Z"), covers_now: true, covers_tomorrow: false },
      { schema: "public", name: "transit_delays", partitions: 0, has_default: true, default_rows_estimate: 12, oldest_from: null, newest_to: null, covers_now: false, covers_tomorrow: false },
    ],
    longQueries: [{ pid: 2, role: "r", state: "active", seconds: 41, wait_event_type: "Lock", wait_event: "relation", query: "select ?" }],
    locks: [
      { pid: 3, role: "r", blocked_by: [4, 5], locktype: "relation", mode: "AccessExclusiveLock", relation: "public.t", seconds: 7 },
      { pid: 6, role: "r", blocked_by: [3], locktype: "transactionid", mode: "ShareLock", relation: null, seconds: null },
    ],
    vacuum: [{ schema: "public", name: "t", live: 10, dead: 2, dead_pct: 16.7, last_autovacuum: null, last_autoanalyze: new Date(0), autovacuums: 1 }],
    wraparound: [{ schema: "public", name: "t", xid_age: 123456 }],
    vacuumRunning: 1,
  };
  const ahead = compare([f], [
    { version: 1, checksum: f.checksum },
    { version: 2, checksum: "1".repeat(64) },
  ]);
  const pending = compare([f, describeFile("0002_b.sql", Buffer.from("b\n"))], [{ version: 1, checksum: f.checksum }]);
  const migrateRun = { action: "migrate" as const, subject: "-", trigger: "boot" as const, startedAt: new Date(0), finishedAt: new Date(0), durationMs: 5, ok: true, exitCode: 0, lines: ["✓ 1 migration(s) applied"] };

  it("renders every row of every table", () => {
    const html = statusPage({ ...snapshot, schema: ahead, busy: "migrate", lastMigrate: migrateRun }, full, null, { signedIn: false, enabled: false }, null);
    for (const want of ["2026-11-01", "2026-11-21", "public.transit_delays", "<td>NO</td>", "Lock/relation", "4, 5", "public.t", "AccessExclusiveLock", "123456", "1 vacuum(s) running", "running: migrate", "newer than this image (up to 2)", "3.4", "✓ 1 migration(s) applied"]) {
      expect(html, want).toContain(want);
    }
  });
  it("names the pending files", () => {
    expect(statusPage({ ...snapshot, schema: pending }, full, null, { signedIn: false, enabled: false }, null)).toContain("Pending: 0002_b.sql");
  });
  it("says the schema is unknown when the ledger could not be read", () => {
    const html = statusPage({ ...snapshot, schema: null }, null, null, { signedIn: false, enabled: false }, null);
    expect(html).toContain("database head ?, ? pending");
    expect(html).toContain("The database could not be read: unknown");
  });
  it.each<["partitions" | "migrate" | "check", string]>([
    ["partitions", "partitions ensure for today+30"],
    ["migrate", "migrate"],
    ["check", "check"],
  ])("confirms %s", (action, what) => {
    expect(confirmPage(action, "30", "c", "k")).toContain(what);
  });
});

