import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCosts, planShards, shardOf } from "../scripts/mutate-run.js";
import { FILE, MUTANTS, TESTS } from "../scripts/mutants.js";
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
function definedAt(sql: string, at: number): { name: string; block: string } | null {
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
  return end < 0 || at <= end ? { name: hit.name, block: sql.slice(hit.start, end < 0 ? sql.length : end) } : null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a later migration's `sql` defines the view or function `name`
 * (whose definition is `block`) again, so that no migrated database carries
 * the earlier definition: it replaces, alters or drops it (a view, a
 * materialized view or a function), or drops with cascade an object the
 * definition reads.
 */
function redefines(sql: string, name: string, block: string): boolean {
  const kind = "(?:materialized )?(?:view|function)";
  if (new RegExp(`^(?:create or replace|alter) ${kind} ${esc(name)}\\b`, "im").test(sql)) return true;
  if (new RegExp(`^drop ${kind}(?: if exists)? ${esc(name)}\\b`, "im").test(sql)) return true;
  for (const m of sql.matchAll(/^drop (?:table|view|materialized view|function|type|schema)(?: if exists)? ([\w.]+)[^;]*\bcascade\b/gim)) {
    if (new RegExp(`\\b${esc(m[1] ?? "")}\\b`, "i").test(block)) return true;
  }
  return false;
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
    // Many mutants sit in the same definition: scan the later migrations once per definition, not once per mutant.
    const seen = new Map<string, string[]>();
    for (const m of MUTANTS) {
      const f = m.file ?? FILE;
      if (!/[/\\]db[/\\](baseline|migrations)[/\\]\d{4}_[^/\\]+\.sql$/.test(f)) continue;
      const def = definedAt(text(f), text(f).indexOf(m.from) + changeAt(m.from, m.to));
      if (def === null) continue;
      const key = `${f}\0${def.name}\0${def.block}`;
      let by = seen.get(key);
      if (by === undefined) {
        by = later.filter((x) => x.v > version(f) && redefines(x.sql, def.name, def.block)).map((x) => String(x.v));
        seen.set(key, by);
      }
      if (by.length > 0) bad.push(`${m.name}: ${def.name} is defined again by ${by.join(", ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("the replacement check sees a view a later migration replaces", () => {
    const sql = "create view contract.road as\nselect null::numeric(6,1) as length_km;\ngrant select on contract.road to api_reader;\ncreate function f() returns int language sql as $$ select 1; $$;\n";
    expect(definedAt(sql, sql.indexOf("numeric"))?.name).toBe("contract.road");
    expect(definedAt(sql, sql.indexOf("grant"))).toBeNull();
    expect(definedAt(sql, sql.indexOf("1;"))?.name).toBe("f");
    expect(changeAt("a b c", "a x c")).toBe(2);
    const road = definedAt(sql, sql.indexOf("numeric"));
    const by = later.filter((x) => x.v > 307 && road !== null && redefines(x.sql, road.name, road.block)).map((x) => x.v);
    expect(by).toEqual([312, 316]);
  });

  it("a definition counts as made again when a later migration replaces, alters or drops it, or drops with cascade what it reads", () => {
    const block = "create view public.v as\n select x from public.t";
    const again = (sql: string): boolean => redefines(sql, "public.v", block);
    expect(again("create or replace view public.v as select 1;")).toBe(true);
    expect(again("create or replace function public.v() returns int language sql as $$ select 1 $$;")).toBe(true);
    expect(again("drop view if exists public.v;")).toBe(true);
    expect(again("drop materialized view public.v;")).toBe(true);
    expect(again("drop function public.v(int);")).toBe(true);
    expect(again("alter view public.v rename to w;")).toBe(true);
    expect(again("alter materialized view public.v rename to w;")).toBe(true);
    expect(again("alter function public.v(int) rename to w;")).toBe(true);
    expect(again("drop table public.t cascade;")).toBe(true);
    expect(again("drop table public.t;")).toBe(false);
    expect(again("drop table public.t2 cascade;")).toBe(false);
    expect(again("create or replace view public.vv as select 1;")).toBe(false);
  });
});

describe("the release's shards of the set", () => {
  // The count release.yml's mutant-shards matrix runs (test/workflows.test.ts holds the workflow to it).
  const COUNT = 12;
  // every job has 15 minutes; a shard plans 12 of them, one of which is its setup (checkout, npm ci, psql).
  const BUDGET_S = 12 * 60;
  const SETUP_S = 60;
  const costs = parseCosts(readFileSync(join(REPO, "scripts", "mutant-costs.tsv"), "utf8"));
  const shards = Array.from({ length: COUNT }, (_, k) => shardOf(MUTANTS, { index: k + 1, count: COUNT }, costs, { tests: TESTS }));

  it("lose no mutant and count none twice: the union of the shards is the real list, and none is empty", () => {
    const names = shards.flatMap((sh) => sh.map((m) => m.name));
    expect(names.length).toBe(MUTANTS.length);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(MUTANTS.map((m) => m.name).sort());
    for (const sh of shards) expect(sh.length).toBeGreaterThan(0);
  });

  it("each plan fits the budget by the committed cost file: no shard over 12 of its 15 minutes", () => {
    const { loads } = planShards(MUTANTS, COUNT, costs, { tests: TESTS });
    expect(Math.max(...loads) + SETUP_S, loads.map((l) => Math.round(l)).join(" ")).toBeLessThanOrEqual(BUDGET_S);
  });

  it("the cost file names no mutant that is not in the list (a renamed one is measured afresh)", () => {
    const listed = new Set(MUTANTS.map((m) => m.name));
    expect([...costs.keys()].filter((n) => !listed.has(n))).toEqual([]);
  });
});
