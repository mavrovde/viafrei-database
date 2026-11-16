import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PsqlResult, PsqlRunner } from "../src/psql.js";
import { applyRolePasswords, applyRoleSettings, passwordUsable, roleScript, ROLES, SETTINGS_FILE, type RoleSpec } from "../src/roles.js";
import { REPO } from "./helpers.js";
import { byRole, databaseSettings, parseSettings, prodSettings, schemaSettingStatements, settingsFile, settingStatements } from "./role-settings.js";

const PW = "a3f9c2e1b4d5a6f7c8e9d0b1";
const specs: RoleSpec[] = [
  { role: "viafrei_digest", sqlFile: "digest-role-password.sql", fatal: false },
  { role: "viafrei_mcp", sqlFile: "mcp-role-password.sql", fatal: true },
];

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function secrets(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "vfdb-roles-"));
  for (const [n, v] of Object.entries(files)) writeFileSync(join(dir, n), v);
  return dir;
}

function psql(o: { roles?: string[]; applyCode?: number; askCode?: number } = {}): { run: PsqlRunner; scripts: string[]; argv: string[][] } {
  const scripts: string[] = [];
  const argv: string[][] = [];
  const run: PsqlRunner = (script, args = []) => {
    argv.push([...args]);
    const text = script.toString();
    const ask = args.find((a) => a.startsWith("select coalesce((select 1 from pg_roles"));
    if (ask !== undefined) {
      const role = /rolname = '([a-z_]+)'/.exec(ask)?.[1] ?? "";
      return Promise.resolve<PsqlResult>({ code: o.askCode ?? 0, stdout: (o.roles ?? ["viafrei_digest", "viafrei_mcp"]).includes(role) ? "1\n" : "0\n", stderr: "" });
    }
    scripts.push(text);
    return Promise.resolve<PsqlResult>({ code: o.applyCode ?? 0, stdout: "", stderr: `ERROR: alter role x password '${PW}'` });
  };
  return { run, scripts, argv };
}

const sqlDir = join(REPO, "db", "roles");

describe("applyRolePasswords", () => {
  it("applies each mounted password through stdin's first line, never argv, and never logs it", async () => {
    const p = psql();
    const log: string[] = [];
    const r = await applyRolePasswords({ psql: p.run, secretDir: secrets({ viafrei_digest: `${PW}\n`, viafrei_mcp: PW }), sqlDir, roles: specs, log: (l) => log.push(l) });
    expect(r.ok).toBe(true);
    expect(r.outcomes.map((x) => x.outcome)).toEqual(["applied", "applied"]);
    expect(p.scripts[0]?.startsWith(`\\set pw ${PW}\n-- `)).toBe(true);
    expect(p.argv.flat().join(" ")).not.toContain(PW);
    expect(log.join("\n")).not.toContain(PW);
  });

  it("is not ok when a fatal role has no file, but only warns for a non-fatal one", async () => {
    const r1 = await applyRolePasswords({ psql: psql().run, secretDir: secrets({ viafrei_mcp: PW }), sqlDir, roles: specs, log: () => undefined });
    expect(r1.ok).toBe(true);
    expect(r1.outcomes[0]).toEqual({ role: "viafrei_digest", outcome: "no-file", fatal: false });
    rmSync(dir, { recursive: true, force: true });
    const r2 = await applyRolePasswords({ psql: psql().run, secretDir: secrets({ viafrei_digest: PW }), sqlDir, roles: specs, log: () => undefined });
    expect(r2.ok).toBe(false);
  });

  it("refuses a password that is not one word, without printing it", async () => {
    const log: string[] = [];
    const bad = "two words and enough length";
    const r = await applyRolePasswords({ psql: psql().run, secretDir: secrets({ viafrei_digest: PW, viafrei_mcp: bad }), sqlDir, roles: specs, log: (l) => log.push(l) });
    expect(r.ok).toBe(false);
    expect(r.outcomes[1]?.outcome).toBe("unusable");
    expect(log.join("\n")).not.toContain(bad);
  });

  it("reports a role the migrations did not create, and a psql that fails, without its error text", async () => {
    const r1 = await applyRolePasswords({ psql: psql({ roles: ["viafrei_digest"] }).run, secretDir: secrets({ viafrei_digest: PW, viafrei_mcp: PW }), sqlDir, roles: specs, log: () => undefined });
    expect(r1.outcomes[1]?.outcome).toBe("no-role");
    expect(r1.ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });
    const log: string[] = [];
    const r2 = await applyRolePasswords({ psql: psql({ applyCode: 3 }).run, secretDir: secrets({ viafrei_digest: PW, viafrei_mcp: PW }), sqlDir, roles: specs, log: (l) => log.push(l) });
    expect(r2.outcomes.map((x) => x.outcome)).toEqual(["failed", "failed"]);
    expect(log.join("\n")).not.toContain(PW);
    expect(log.join("\n")).not.toContain("ERROR");
  });
});

describe("the role table and its SQL", () => {
  it("names a file in db/roles for every role, each altering exactly that role from :'pw' with statement logging off", async () => {
    const { readFileSync } = await import("node:fs");
    for (const r of ROLES) {
      const sql = readFileSync(join(sqlDir, r.sqlFile), "utf8");
      expect(sql).toContain(`alter role ${r.role} password :'pw';`);
      expect(sql.indexOf("\nset log_statement = 'none';")).toBeGreaterThan(-1);
      expect(sql.indexOf("\nset log_statement = 'none';")).toBeLessThan(sql.indexOf(`\nalter role ${r.role} password`));
    }
  });
  it("holds viafrei-api's two roles as warnings: a deployment that mounts no API secret stays ready", () => {
    expect(ROLES.filter((r) => r.role.startsWith("api_"))).toEqual([
      { role: "api_reader", sqlFile: "api-reader-role-password.sql", fatal: false },
      { role: "api_access", sqlFile: "api-access-role-password.sql", fatal: false },
    ]);
    expect(ROLES.filter((r) => r.fatal).map((r) => r.role)).toEqual(["viafrei_mcp", "viafrei_translate", "viafrei_ops", "viafrei_ingestor"]);
  });
  it("roleScript puts the \\set line first", () => {
    expect(roleScript("x", "sql")).toBe("\\set pw x\nsql");
  });
  it("passwordUsable takes 16-200 safe characters only", () => {
    expect(passwordUsable("a".repeat(16))).toBe(true);
    expect(passwordUsable("a".repeat(15))).toBe(false);
    expect(passwordUsable("a".repeat(201))).toBe(false);
    expect(passwordUsable(`${"a".repeat(16)}'`)).toBe(false);
    expect(passwordUsable(`${"a".repeat(16)}\\`)).toBe(false);
  });

  it("says so when the database cannot be asked whether the role exists", async () => {
    const lines: string[] = [];
    const r = await applyRolePasswords({ psql: psql({ askCode: 2 }).run, secretDir: secrets({ viafrei_mcp: PW }), sqlDir, roles: specs.slice(1), log: (l) => lines.push(l) });
    expect(r.ok).toBe(false);
    expect(r.outcomes).toEqual([{ role: "viafrei_mcp", outcome: "failed", fatal: true }]);
    expect(lines).toEqual(["✗ viafrei_mcp: the database could not be asked whether the role exists"]);
  });

  it("logs to stdout when no log is given", async () => {
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
    try {
      await applyRolePasswords({ psql: psql().run, secretDir: secrets({}), sqlDir, roles: specs.slice(0, 1) });
    } finally {
      spy.mockRestore();
    }
    expect(out).toEqual(["⚠ viafrei_digest: no password file was mounted — the password was NOT applied\n"]);
  });
});

describe("applyRoleSettings (db/roles/settings.sql)", () => {
  const ok: PsqlRunner = () => Promise.resolve({ code: 0, stdout: "", stderr: "" });

  it("sends the file to psql on stdin and counts its statements", async () => {
    const seen: { script: string; args: string }[] = [];
    const run: PsqlRunner = (s, a = []) => (seen.push({ script: String(s), args: a.join(" ") }), Promise.resolve({ code: 0, stdout: "", stderr: "" }));
    const r = await applyRoleSettings(run, join(REPO, "db", "roles"));
    expect(r.ok).toBe(true);
    expect(r.line).toMatch(/^ {2}role settings: 44 applied to this database/);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.args).toBe("-f -");
    expect(seen[0]?.script).toBe(readFileSync(join(REPO, "db", "roles", SETTINGS_FILE), "utf8"));
  });

  it("refuses a missing file, a file with no statement and a failed psql, never reporting them applied", async () => {
    const t = mkdtempSync(join(tmpdir(), "vfdb-settings-"));
    try {
      expect(await applyRoleSettings(ok, t)).toEqual({ ok: false, line: "✗ role settings: settings.sql could not be read from the roles directory" });
      writeFileSync(join(t, SETTINGS_FILE), "-- nothing\n");
      expect((await applyRoleSettings(ok, t)).line).toMatch(/holds no statement/);
      const failed = await applyRoleSettings(() => Promise.resolve({ code: 3, stdout: "", stderr: 'ERROR:  role "viafrei_mcp" does not exist\n' }), join(REPO, "db", "roles"));
      expect(failed).toEqual({ ok: false, line: '✗ role settings could not be applied (psql exit 3): ERROR:  role "viafrei_mcp" does not exist' });
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  });
});

describe("db/roles/settings.sql is the schema's role settings", () => {
  it("holds the baseline's ALTER ROLE … IN DATABASE statements and every later migration's, in order, and nothing else", () => {
    const schema = schemaSettingStatements();
    expect(schema.length).toBeGreaterThanOrEqual(43);
    expect(settingStatements(settingsFile())).toEqual(schema);
    expect(settingsFile().split("\n").filter((l) => l.trim() !== "" && !l.startsWith("--") && !l.includes("ALTER DATABASE"))).toEqual(schema);
  });

  it("holds production's settings: every role's, value for value, and the database-wide search_path of database viafrei", () => {
    const prod = prodSettings();
    expect(prod).toHaveLength(40);
    const norm = (x: string): string => {
      const [n = "", ...v] = x.split("=");
      return `${n.toLowerCase()}=${v.join("=").toLowerCase()}`;
    };
    // viafrei-api's two roles (0307, 0308) are newer than the measurement: their five settings are held
    // to the API's own DDL here, and production gets them with the release that brings the roles.
    const all = [...byRole(parseSettings(settingsFile()), "viafrei")].flatMap(([role, s]) => s.map((x) => `${role}|${norm(x)}`)).sort();
    expect(all.filter((x) => x.startsWith("api_"))).toEqual([
      "api_access|idle_in_transaction_session_timeout=5s",
      "api_access|statement_timeout=2s",
      "api_reader|default_transaction_read_only=on",
      "api_reader|idle_in_transaction_session_timeout=5s",
      "api_reader|statement_timeout=2s",
    ]);
    const ours = all.filter((x) => !x.startsWith("api_"));
    const theirs = prod.filter((p) => p.database === "(all dbs)").map((p) => `${p.role}|${norm(p.setting)}`).sort();
    expect(ours).toEqual(theirs);
    expect(databaseSettings(settingsFile())).toEqual(prod.filter((p) => p.role === "(all roles)" && p.database === "viafrei").map((p) => p.setting));
    expect(databaseSettings(settingsFile())).toEqual(['search_path="$user", public, topology, tiger']);
    expect(() => databaseSettings("DO $$ BEGIN EXECUTE 'ALTER DATABASE x SET a = 1'; END $$;")).toThrow(/a shape this reader does not know/);
  });

  it("every statement parses to a role, a setting and a value, the readers' memory and jit among them", () => {
    const s = parseSettings(settingsFile());
    expect(s).toHaveLength(43);
    const m = byRole(s, "owner");
    expect(m.get("viafrei_mcp")).toContain("jit=off");
    expect(m.get("viafrei_digest")).toEqual(expect.arrayContaining(["jit=off", "work_mem=16MB", "hash_mem_multiplier=1.0", "max_parallel_workers_per_gather=0", "default_transaction_read_only=on"]));
    expect(m.get("owner")).toEqual(["hash_mem_multiplier=1.0", "jit=off", "maintenance_work_mem=64MB", "max_parallel_maintenance_workers=0", "max_parallel_workers_per_gather=0", "work_mem=16MB"]);
    expect([...m.keys()].sort()).toEqual(["api_access", "api_reader", "owner", "viafrei_digest", "viafrei_ingestor", "viafrei_mcp", "viafrei_ops", "viafrei_status", "viafrei_translate"]);
    expect(() => parseSettings("DO $$ BEGIN EXECUTE 'ALTER ROLE x IN DATABASE y SET a = 1'; END $$;")).toThrow(/a shape this reader does not know/);
  });
});
