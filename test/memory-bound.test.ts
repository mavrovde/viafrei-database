/**
 * The memory bound's `-- bound:` arithmetic (#31 item 7), carried in db/roles/settings.sql beside the settings it sizes:
 *
 *   the arithmetic   every figure the headers write out is re-derived from the
 *                    bound lines: each reader's worst case, the readers' sum and
 *                    its share of the headroom, the build budget left under the
 *                    cap, each build's work_mem, and the total under the cap;
 *   the settings     the work_mem, hash_mem_multiplier and parallel settings of
 *                    the owner and both readers in settings.sql are the bound's
 *                    inputs (test/consumer.db.test.ts holds a migrated database
 *                    equal to that file).
 *
 * The pools behind `connections` and the db service's headroom are the
 * consumers' and the deploy's, and are judged there.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { parseSettings } from "./role-settings.js";

const SQL = readFileSync(join(REPO, "db", "roles", "settings.sql"), "utf8");

/** `-- bound: <name> k=v …` → name → k → number; `-- bound: k=v …` → "" → k → number. */
export function boundLines(sql: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const m of sql.matchAll(/^--\s+bound: (.*)$/gm)) {
    const words = (m[1] ?? "").trim().split(/\s+/);
    const name = words[0]?.includes("=") === true ? "" : (words.shift() ?? "");
    const kv = out.get(name) ?? new Map<string, number>();
    for (const w of words) {
      const [k, v] = w.split("=");
      if (k === undefined || v === undefined || !/^\d+(\.\d+)?$/.test(v)) throw new Error(`bound ${name}: "${w}" is not k=<number>`);
      kv.set(k, Number(v));
    }
    out.set(name, kv);
  }
  return out;
}

const b = boundLines(SQL);
const get = (name: string, key: string): number => {
  const v = b.get(name)?.get(key);
  if (v === undefined) throw new Error(`bound ${name || "(top)"} has no ${key}`);
  return v;
};
const worst = (name: string): number =>
  get(name, "connections") * get(name, "work_mem_mb") * get(name, "hash_mem_multiplier") * get(name, "nodes") * (b.get(name)?.get("processes") ?? 1);
const READERS = ["viafrei_digest", "viafrei_mcp"];
const BUILDS = [...(b.get("build_nodes")?.keys() ?? [])].sort();
const cap = (): number => (get("", "cap_pct") / 100) * get("", "headroom_mb");
const autovacuum = (): number => get("autovacuum", "workers") * get("autovacuum", "work_mem_mb");
const buildWorkMem = (build: string): number => Math.max(get("build", "floor_mb"), Math.floor(get("build", "budget_mb") / get("build_nodes", build)));

const settings = parseSettings(SQL);
const setting = (role: string, name: string): string | undefined => settings.find((s) => s.role === role && s.name === name)?.value;

describe("the memory bound: the arithmetic of its lines", () => {
  const peak = (role: string): number => Math.ceil((get("peaks", role) * (100 + get("peaks", "margin_pct"))) / 100);
  const headroom = (sbMb: number): number => get("", "pod_mb") - sbMb;
  const maintenance = (): number => get("maintenance", "builds") * get("maintenance", "maintenance_work_mem_mb");
  const rest = (): number => worst("owner_other") + worst("others") + maintenance() + autovacuum() + get("build", "budget_mb");
  const total = (): number => get("", "readers_mb") + rest();

  it("settings.sql carries every bound line: the peaks, both readers, the owner's, the others, maintenance, autovacuum and the pod", () => {
    expect([...b.keys()].sort()).toEqual(["", "autovacuum", "build", "build_nodes", "maintenance", "others", "owner_other", "owner_role", "peaks", "viafrei_digest", "viafrei_mcp"]);
    expect({ pod: get("", "pod_mb"), sb: get("", "shared_buffers_mb"), cap: get("", "cap_pct") }).toEqual({ pod: 40960, sb: 7168, cap: 90 });
    expect(get("", "headroom_mb")).toBe(headroom(get("", "shared_buffers_mb")));
    expect(get("", "headroom_mb")).toBe(33792);
    expect(BUILDS).toEqual(["gtfs_route_kreise", "gtfs_untimed_trips", "transit_stop_modes"]);
  });

  it("each role's connections are its measured peak plus the margin, rounded up; the owner's less the session the build runs on", () => {
    expect(get("peaks", "margin_pct")).toBe(30);
    for (const r of READERS) expect(get(r, "connections"), r).toBe(peak(r));
    expect(get("owner_other", "connections")).toBe(peak("viafrei") - 1);
    expect(get("others", "connections")).toBe(peak("viafrei_ingestor") + peak("viafrei_translate"));
    expect({ digest: get("viafrei_digest", "connections"), mcp: get("viafrei_mcp", "connections"), owner_other: get("owner_other", "connections"), others: get("others", "connections") }).toEqual({
      digest: 33,
      mcp: 12,
      owner_other: 32,
      others: 5,
    });
  });

  it("each reader's worst case, their sum the owner's readers_mb, and inside 80 % of the headroom", () => {
    expect(Object.fromEntries(READERS.map((r) => [r, worst(r)]))).toEqual({ viafrei_digest: 8448, viafrei_mcp: 3072 });
    const readers = READERS.reduce((s, r) => s + worst(r), 0);
    expect(readers).toBe(get("", "readers_mb"));
    expect(readers).toBeLessThanOrEqual(0.8 * get("", "headroom_mb"));
  });

  it("readers, the other owner sessions, the other roles, maintenance, autovacuum and the build budget fit under the cap", () => {
    expect({ owner_other: worst("owner_other"), others: worst("others"), maintenance: maintenance(), autovacuum: autovacuum(), build: get("build", "budget_mb") }).toEqual({
      owner_other: 8192,
      others: 640,
      maintenance: 256,
      autovacuum: 90,
      build: 9586,
    });
    expect(total()).toBe(30284);
    expect(cap()).toBeCloseTo(30412.8, 6);
    expect(total()).toBeLessThanOrEqual(cap());
  });

  it("shared_buffers is the largest whole GB under which the total fits", () => {
    const capAt = (sbMb: number): number => (get("", "cap_pct") / 100) * headroom(sbMb);
    expect(total()).toBeLessThanOrEqual(capAt(get("", "shared_buffers_mb")));
    expect(total()).toBeGreaterThan(capAt(get("", "shared_buffers_mb") + 1024));
  });

  it("each build's work_mem is its share of the budget per node, never under the floor, and its nodes fit the budget", () => {
    expect(Object.fromEntries(BUILDS.map((x) => [x, buildWorkMem(x)]))).toEqual({ gtfs_untimed_trips: 9586, gtfs_route_kreise: 3195, transit_stop_modes: 1917 });
    for (const x of BUILDS) expect(buildWorkMem(x) * get("build_nodes", x), x).toBeLessThanOrEqual(get("build", "budget_mb"));
  });

  it("the other owner sessions run at the owner role's work_mem and multiplier, one process each (no parallel worker), and maintenance at its maintenance_work_mem", () => {
    expect(get("owner_other", "work_mem_mb")).toBe(get("owner_role", "work_mem_mb"));
    expect(get("owner_other", "hash_mem_multiplier")).toBe(get("owner_role", "hash_mem_multiplier"));
    expect(get("owner_other", "processes")).toBe(1 + get("owner_role", "parallel_per_gather"));
    expect(get("build", "floor_mb")).toBe(get("owner_role", "work_mem_mb"));
    expect(get("maintenance", "maintenance_work_mem_mb")).toBe(get("owner_role", "maintenance_work_mem_mb"));
  });

  it("a bound line whose value is not a number is refused, not read as NaN", () => {
    expect(() => boundLines("--   bound: viafrei_mcp connections=lots\n")).toThrow(/not k=<number>/);
  });
});

describe("the memory bound: the settings are its inputs", () => {
  it.each(READERS)("%s: work_mem and hash_mem_multiplier are its bound's, jit off", (role) => {
    expect(setting(role, "work_mem")).toBe(`${String(get(role, "work_mem_mb"))}MB`);
    expect(Number(setting(role, "hash_mem_multiplier"))).toBe(get(role, "hash_mem_multiplier"));
    expect(setting(role, "jit")).toBe("off");
  });

  it("the owner (CURRENT_USER, the role migrations run as) carries every setting of owner_role", () => {
    expect({
      work_mem: setting("CURRENT_USER", "work_mem"),
      hash_mem_multiplier: Number(setting("CURRENT_USER", "hash_mem_multiplier")),
      max_parallel_workers_per_gather: setting("CURRENT_USER", "max_parallel_workers_per_gather"),
      jit: setting("CURRENT_USER", "jit"),
      maintenance_work_mem: setting("CURRENT_USER", "maintenance_work_mem"),
      max_parallel_maintenance_workers: setting("CURRENT_USER", "max_parallel_maintenance_workers"),
    }).toEqual({
      work_mem: `${String(get("owner_role", "work_mem_mb"))}MB`,
      hash_mem_multiplier: get("owner_role", "hash_mem_multiplier"),
      max_parallel_workers_per_gather: String(get("owner_role", "parallel_per_gather")),
      jit: "off",
      maintenance_work_mem: `${String(get("owner_role", "maintenance_work_mem_mb"))}MB`,
      max_parallel_maintenance_workers: String(get("owner_role", "parallel_maintenance")),
    });
  });
});
