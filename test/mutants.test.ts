import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FILE, MUTANTS } from "../scripts/mutants.js";
import { REPO } from "./helpers.js";

const MIGRATIONS = join(REPO, "db", "migrations");
const version = (file: string): number => Number(/^(\d{4})_/.exec(basename(file))?.[1] ?? "0");
const later = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ v: version(f), sql: readFileSync(join(MIGRATIONS, f), "utf8") }));

/**
 * The view or function whose definition holds offset `at` of `sql`: the last
 * top-level `create … view|function <name>` above it, if its definition (a
 * view up to its first `;` at a line end, a function up to the end of its
 * dollar-quoted body) reaches that far.
 */
function definedAt(sql: string, at: number): string | null {
  let hit: { name: string; start: number; fn: boolean } | null = null;
  for (const m of sql.slice(0, at).matchAll(/^create (?:or replace )?(?:materialized )?(view|function) ([\w.]+)/gim)) {
    hit = { name: (m[2] ?? "").toLowerCase(), start: m.index, fn: (m[1] ?? "").toLowerCase() === "function" };
  }
  if (hit === null) return null;
  let end = sql.indexOf(";\n", hit.start);
  if (hit.fn) {
    const open = /\$(\w*)\$/.exec(sql.slice(hit.start));
    const tag = open?.[0] ?? "";
    const body = open === null ? -1 : sql.indexOf(tag, hit.start + open.index + tag.length);
    end = body < 0 ? end : body + tag.length;
  }
  return end < 0 || at <= end ? hit.name : null;
}

/** Where `to` first differs from `from`. */
const changeAt = (from: string, to: string): number => {
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i += 1;
  return i;
};

describe("the mutant set", () => {
  const texts = new Map<string, string>();
  const text = (f: string): string => {
    const t = texts.get(f) ?? readFileSync(f, "utf8");
    texts.set(f, t);
    return t;
  };

  it("each mutant plants a change at exactly one place of its file, under a name of its own", () => {
    const bad = MUTANTS.map((m) => ({ m, n: text(m.file ?? FILE).split(m.from).length - 1 }))
      .filter(({ m, n }) => n !== 1 || m.from === m.to)
      .map(({ m, n }) => `${m.name}: found ${String(n)} time(s)`);
    expect(bad).toEqual([]);
    expect(new Set(MUTANTS.map((m) => m.name)).size).toBe(MUTANTS.length);
  });

  it("no schema mutant changes a view or function a later migration defines again, where no migrated database would carry it", () => {
    const bad: string[] = [];
    for (const m of MUTANTS) {
      const f = m.file ?? FILE;
      if (!/[/\\]db[/\\](baseline|migrations)[/\\]\d{4}_[^/\\]+\.sql$/.test(f)) continue;
      const name = definedAt(text(f), text(f).indexOf(m.from) + changeAt(m.from, m.to));
      if (name === null) continue;
      const again = new RegExp(`^(?:create or replace (?:view|function)|drop (?:view|function)(?: if exists)?) ${name.replace(/\./g, "\\.")}\\b`, "im");
      const by = later.filter((x) => x.v > version(f) && again.test(x.sql)).map((x) => String(x.v));
      if (by.length > 0) bad.push(`${m.name}: ${name} is defined again by ${by.join(", ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("the replacement check sees a view a later migration replaces", () => {
    const sql = "create view contract.road as\nselect null::numeric(6,1) as length_km;\ngrant select on contract.road to api_reader;\ncreate function f() returns int language sql as $$ select 1; $$;\n";
    expect(definedAt(sql, sql.indexOf("numeric"))).toBe("contract.road");
    expect(definedAt(sql, sql.indexOf("grant"))).toBeNull();
    expect(definedAt(sql, sql.indexOf("1;"))).toBe("f");
    expect(changeAt("a b c", "a x c")).toBe(2);
    const by = later.filter((x) => x.v > 307 && /^create or replace view contract\.road\b/im.test(x.sql)).map((x) => x.v);
    expect(by).toEqual([312]);
  });
});
