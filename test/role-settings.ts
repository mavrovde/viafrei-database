/**
 * The role settings as data: every `ALTER ROLE <role> IN DATABASE %I SET <name>
 * TO '<value>'` of a SQL text, the shape the baseline, the migrations after it
 * and db/roles/settings.sql write them in.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { byCodeUnit } from "./generator-input.js";
import { REPO } from "./helpers.js";

export type Setting = { readonly role: string; readonly name: string; readonly value: string };

const STATEMENT = /^DO \$\$ BEGIN EXECUTE format\('ALTER ROLE (\S+) IN DATABASE %I SET ("?)([A-Za-z_]+)\2 TO ''([^']*)''', current_database\(\)\); END \$\$;$/;

/** The statements of a text, each as written, in order. */
export function settingStatements(sql: string): string[] {
  return sql.split("\n").filter((l) => !l.trimStart().startsWith("--") && /\bALTER ROLE\b.*\bIN DATABASE\b/i.test(l));
}

/** The settings of a text; a line that names ALTER ROLE … IN DATABASE in another shape throws, so none is skipped. */
export function parseSettings(sql: string): Setting[] {
  return settingStatements(sql).map((l) => {
    const m = STATEMENT.exec(l);
    if (m === null) throw new Error(`a role setting in a shape this reader does not know: ${l.slice(0, 120)}`);
    return { role: m[1] ?? "", name: (m[3] ?? "").toLowerCase(), value: m[4] ?? "" };
  });
}

/** The baseline's statements, then every migration's after it, in file order. */
export function schemaSettingStatements(): string[] {
  const out = settingStatements(readFileSync(join(REPO, "db", "baseline", "0293_baseline.sql"), "utf8"));
  for (const f of readdirSync(join(REPO, "db", "migrations")).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()) {
    out.push(...settingStatements(readFileSync(join(REPO, "db", "migrations", f), "utf8")));
  }
  return out;
}

const DATABASE_STATEMENT = /^DO \$\$ BEGIN EXECUTE format\('ALTER DATABASE %I SET ([a-z_]+) TO (.+)', current_database\(\)\); END \$\$;$/;

/** The database-wide settings of a text (`ALTER DATABASE %I SET …`), as `name=value` the way pg_db_role_setting holds them. */
export function databaseSettings(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--") && /\bALTER DATABASE\b/i.test(l))
    .map((l) => {
      const m = DATABASE_STATEMENT.exec(l);
      if (m === null) throw new Error(`a database setting in a shape this reader does not know: ${l.slice(0, 120)}`);
      return `${m[1] ?? ""}=${m[2] ?? ""}`;
    });
}

/** test/roles/prod-settings.tsv: production's pg_db_role_setting, as role or "(all roles)", database or "(all dbs)", `name=value`. */
export function prodSettings(): { role: string; database: string; setting: string }[] {
  return readFileSync(join(REPO, "test", "roles", "prod-settings.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => {
      const [role = "", database = "", setting = "", ...rest] = l.split("\t");
      if (rest.length > 0 || !setting.includes("=")) throw new Error(`prod-settings.tsv: ${JSON.stringify(l)}`);
      return { role, database, setting };
    });
}

export const settingsFile = (): string => readFileSync(join(REPO, "db", "roles", "settings.sql"), "utf8");

/** The settings in force after applying them in order: a later statement of the same role and setting supersedes an earlier one, in its place. */
export function inForce(settings: readonly Setting[]): Setting[] {
  const last = new Map<string, Setting>();
  for (const s of settings) {
    const k = `${s.role}\u0000${s.name}`;
    last.delete(k);
    last.set(k, s);
  }
  return [...last.values()];
}

/** role → sorted `name=value` lines, the shape pg_db_role_setting.setconfig holds, the later of two statements of a setting winning; CURRENT_USER becomes `owner`. */
export function byRole(settings: readonly Setting[], owner: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of inForce(settings)) {
    const role = s.role === "CURRENT_USER" ? owner : s.role;
    out.set(role, [...(out.get(role) ?? []), `${s.name}=${s.value}`]);
  }
  for (const [k, v] of out) out.set(k, [...v].sort(byCodeUnit));
  return out;
}
