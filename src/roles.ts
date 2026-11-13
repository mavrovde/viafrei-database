/**
 * The service roles' passwords, applied after the migrations that create the
 * roles.
 *
 * The deployment keeps the secrets; this repository owns the SQL (db/roles/). Each
 * password arrives as a FILE in a mounted Secret directory (`VF_DB_ROLE_DIR`,
 * one file per role, named exactly like the role) and goes to psql as the
 * first line of stdin, `\set pw <value>`, followed by the role's SQL file,
 * which binds it as `:'pw'` and switches statement logging off for the session.
 * Never an argument, never `-v`: argv is readable by every process.
 *
 * Severity: a missing ROLE is fatal for the roles a service
 * cannot run without (mcp, translate, ops, ingestor) and a warning for the two
 * whose service degrades to "unavailable" (status, digest). A missing FILE is
 * a secret the deployment did not mount: reported, and fatal for the fatal ones.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PsqlRunner } from "./psql.js";

export type RoleSpec = { readonly role: string; readonly sqlFile: string; readonly fatal: boolean };

export const ROLES: readonly RoleSpec[] = [
  { role: "viafrei_status", sqlFile: "status-role-password.sql", fatal: false },
  { role: "viafrei_digest", sqlFile: "digest-role-password.sql", fatal: false },
  { role: "viafrei_mcp", sqlFile: "mcp-role-password.sql", fatal: true },
  { role: "viafrei_translate", sqlFile: "translate-role-password.sql", fatal: true },
  { role: "viafrei_ops", sqlFile: "ops-role-password.sql", fatal: true },
  { role: "viafrei_ingestor", sqlFile: "ingestor-role-password.sql", fatal: true },
];

/**
 * A password psql's `\set` can carry as ONE word: no whitespace, no quote, no
 * backslash. The deploy generates them with `openssl rand -hex`, so this
 * refuses nothing real and stops a value that would be split or escaped.
 */
export function passwordUsable(pw: string): boolean {
  return pw.length >= 16 && pw.length <= 200 && /^[A-Za-z0-9._~+=-]+$/.test(pw);
}

/** The stdin of one role step: the `\set` line, then the SQL file. */
export function roleScript(pw: string, sql: string): string {
  return `\\set pw ${pw}\n${sql}`;
}

export const ROLE_EXISTS = (role: string): string => `select coalesce((select 1 from pg_roles where rolname = '${role}'), 0)`;

export type RoleOutcome = { readonly role: string; readonly outcome: "applied" | "no-file" | "no-role" | "unusable" | "failed"; readonly fatal: boolean };

export type RolesResult = { readonly ok: boolean; readonly outcomes: readonly RoleOutcome[] };

export async function applyRolePasswords(o: {
  readonly psql: PsqlRunner;
  readonly secretDir: string;
  readonly sqlDir: string;
  readonly roles?: readonly RoleSpec[];
  readonly log?: (line: string) => void;
}): Promise<RolesResult> {
  const log = o.log ?? ((l: string): void => void process.stdout.write(`${l}\n`));
  const outcomes: RoleOutcome[] = [];
  for (const spec of o.roles ?? ROLES) {
    const add = (outcome: RoleOutcome["outcome"], line: string): void => {
      outcomes.push({ role: spec.role, outcome, fatal: spec.fatal && outcome !== "applied" });
      log(line);
    };
    const file = join(o.secretDir, spec.role);
    if (!existsSync(file)) {
      add("no-file", `${spec.fatal ? "✗" : "⚠"} ${spec.role}: no password file was mounted — the password was NOT applied`);
      continue;
    }
    const pw = readFileSync(file, "utf8").replace(/\r?\n$/, "");
    if (!passwordUsable(pw)) {
      add("unusable", `✗ ${spec.role}: the mounted password is not one word of 16-200 letters, digits or ._~+=- — not applied (its value is not printed)`);
      continue;
    }
    const exists = await o.psql("", ["-Atq", "-c", ROLE_EXISTS(spec.role)]);
    if (exists.code !== 0) {
      add("failed", `✗ ${spec.role}: the database could not be asked whether the role exists`);
      continue;
    }
    if (exists.stdout.trim() !== "1") {
      add("no-role", `${spec.fatal ? "✗" : "⚠"} ${spec.role}: the role does not exist after the migrations ran — the password was NOT applied`);
      continue;
    }
    const sql = readFileSync(join(o.sqlDir, spec.sqlFile), "utf8");
    const r = await o.psql(roleScript(pw, sql), ["-f", "-"]);
    // psql's error text could echo the statement; it is never logged here.
    if (r.code !== 0) add("failed", `✗ ${spec.role}: the password could not be applied (psql exit ${String(r.code)})`);
    else add("applied", `  ${spec.role}: password applied from the mounted secret (idempotent)`);
  }
  return { ok: !outcomes.some((x) => x.fatal), outcomes };
}
