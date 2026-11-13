/**
 * The texts a database hands to whoever calls it — an error message, a hint,
 * a run note, a seeded note — say what they mean on their own. They point at
 * no ticket number, no file path of the code that calls them and no process
 * name. Read off the baseline and the migrations after it, so a migration that
 * brings one back is red here before it ships.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

/** What a neutral text does not carry. */
export const NOT_NEUTRAL = /#[0-9]|platform\/|-ingestor\b|\bpod\b|\bk8s\b|\bcli\/|\bsrc\//;

/** Every function body in a dump or migration: `AS $tag$ … $tag$`, or a SQL-standard `RETURN …` up to the blank line after it. */
export function functionBodies(sql: string): { name: string; body: string }[] {
  const starts = [...sql.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)\(/gim)];
  return starts.map((m, k) => {
    const from = m.index;
    const chunk = sql.slice(from, starts[k + 1]?.index ?? sql.length);
    const name = m[1] ?? "?";
    const as = /\n\s*AS (\$[A-Za-z_]*\$)/i.exec(chunk);
    if (as !== null) {
      const open = from + as.index + as[0].length;
      const end = sql.indexOf(as[1] ?? "$$", open);
      if (end < 0) throw new Error(`${name}: no closing ${as[1] ?? "$$"}`);
      return { name, body: sql.slice(open, end) };
    }
    const ret = /\n\s*(?:RETURN |BEGIN ATOMIC)/i.exec(chunk);
    if (ret === null) throw new Error(`${name}: neither an AS body nor a RETURN body`);
    const rest = chunk.slice(ret.index);
    const stop = rest.indexOf("\n\n", 1);
    return { name, body: stop < 0 ? rest : rest.slice(0, stop) };
  });
}

/** The single-quoted literals of a body, '' unescaped. */
export function literals(body: string): string[] {
  return [...body.matchAll(/'((?:[^']|'')*)'/g)].map((m) => (m[1] ?? "").replace(/''/g, "'"));
}

const files = (): { name: string; sql: string }[] => {
  const out: { name: string; sql: string }[] = [];
  for (const dir of ["baseline", "migrations"]) {
    const d = join(REPO, "db", dir);
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    // Only what this repository tracks: the baseline and the migrations after its head.
    const head = Number.parseInt(readdirSync(join(REPO, "db", "baseline")).find((n) => /^\d{4}_baseline\.sql$/.test(n))?.slice(0, 4) ?? "0", 10);
    for (const n of names.filter((x) => /^\d{4}_.*\.sql$/.test(x) && (dir === "baseline" || Number.parseInt(x.slice(0, 4), 10) >= head))) out.push({ name: `${dir}/${n}`, sql: readFileSync(join(d, n), "utf8") });
  }
  return out;
};

describe("the database's own texts are neutral", () => {
  const all = files();

  it("reads the baseline and finds its functions (a sweep over nothing is not a pass)", () => {
    expect(all.some((f) => f.name.startsWith("baseline/"))).toBe(true);
    const n = all.reduce((k, f) => k + functionBodies(f.sql).length, 0);
    expect(n).toBeGreaterThan(50);
  });

  it("no function's message, hint or note carries a ticket number, a code path or a process name", () => {
    const hits: string[] = [];
    for (const f of all) for (const fn of functionBodies(f.sql)) for (const l of literals(fn.body)) if (NOT_NEUTRAL.test(l)) hits.push(`${f.name} ${fn.name}: '${l.slice(0, 80)}'`);
    expect(hits).toEqual([]);
  });

  it("the partition helper's refusal reads as a sentence that ends where it means to", () => {
    const b = all.find((f) => f.name.startsWith("baseline/"));
    const fn = functionBodies(b?.sql ?? "").find((x) => x.name === "public.ensure_daily_partitions");
    const msgs = literals(fn?.body ?? "").filter((l) => l.startsWith("ensure_daily_partitions: "));
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    for (const m of msgs) expect(m).not.toMatch(NOT_NEUTRAL);
  });

  it("the sweep can say no", () => {
    const planted = "CREATE FUNCTION public.f() RETURNS void\n    LANGUAGE plpgsql\n    AS $$ begin raise exception 'boom (#123)'; end $$;\n";
    expect(literals(functionBodies(planted)[0]?.body ?? "").filter((l) => NOT_NEUTRAL.test(l))).toEqual(["boom (#123)"]);
    for (const t of ["see platform/x.ts", "unit a pod b", "from cli/y.ts", "in src/z.ts", "on k8s"]) expect(NOT_NEUTRAL.test(t), t).toBe(true);
    for (const t of ["a cap of 0", "ingest unit a instance b", "client"]) expect(NOT_NEUTRAL.test(t), t).toBe(false);
  });

  it("the seeded feed notes are neutral", () => {
    const b = all.find((f) => f.name.startsWith("baseline/"))?.sql ?? "";
    const at = b.indexOf("COPY public.feeds ");
    expect(at).toBeGreaterThan(0);
    const rows = b.slice(at, b.indexOf("\n\\.\n", at));
    expect(rows.split("\n").length).toBeGreaterThan(1);
    expect(rows).not.toMatch(NOT_NEUTRAL);
  });
});
