import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PsqlResult, PsqlRunner } from "../src/psql.js";
import { applyRolePasswords, passwordUsable, roleScript, ROLES, type RoleSpec } from "../src/roles.js";
import { REPO } from "./helpers.js";

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
