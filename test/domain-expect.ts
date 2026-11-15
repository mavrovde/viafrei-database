/**
 * The assertions several domain-table DB tests make the same way, against
 * domains.speed_cameras as the convention's model (DomainDb's catalogue reads).
 */
import { expect } from "vitest";
import { type DomainDb, SYSTEM, WRITER_TYPES } from "./domain-db.js";

/** What these assertions read of a test's table description. */
export type DomainTable = {
  readonly name: string;
  readonly cols: Readonly<Record<string, string>>;
  readonly kind: string;
  readonly required: readonly string[];
  readonly defaults?: Readonly<Record<string, string>>;
};

/** A lookup of a test's table by name that throws on a name it does not hold. */
export function tableNamed<T extends { readonly name: string }>(tables: readonly T[]): (n: string) => T {
  return (n) => {
    const x = tables.find((y) => y.name === n);
    if (x === undefined) throw new Error(n);
    return x;
  };
}

/** Each table: the system columns of speed_cameras, then its own columns, each in a type a writer declares, with its nullability and default. */
export async function expectSystemThenDomainColumns(t: DomainDb, tables: readonly DomainTable[]): Promise<void> {
  const cameras = (await t.columnsOf("speed_cameras")).slice(0, SYSTEM.length);
  for (const table of tables) {
    const mine = await t.columnsOf(table.name);
    expect(mine.map((x) => x.column_name), table.name).toEqual([...SYSTEM, ...Object.keys(table.cols)]);
    expect(mine.slice(0, SYSTEM.length), table.name).toEqual(cameras);
    for (const x of mine.slice(SYSTEM.length)) {
      const where = `${table.name}.${x.column_name}`;
      expect(x.data_type, where).toBe(table.cols[x.column_name]);
      expect(WRITER_TYPES.has(x.data_type), where).toBe(true);
      expect(x.is_nullable, where).toBe(table.required.includes(x.column_name) ? "NO" : "YES");
      expect(x.column_default, where).toBe(table.defaults?.[x.column_name] ?? null);
    }
  }
}

const KEYS = /T_(owner_key|pkey) /;

/**
 * A tick table's indexes and constraints outside its own (`rest`, its name
 * replaced by T): the owner key and primary key carry observed_at, and the
 * rest is the convention's `model`. `on` is "ON ONLY" for a partitioned table.
 */
export function expectTickShape(rest: readonly string[], model: readonly string[], name: string, on: "ON" | "ON ONLY"): void {
  expect(rest.filter((d) => KEYS.test(d)), name).toEqual([
    `CREATE UNIQUE INDEX T_owner_key ${on} domains.T USING btree (source_id, feed, external_id, observed_at)`,
    `CREATE UNIQUE INDEX T_pkey ${on} domains.T USING btree (id, observed_at)`,
    "p T_pkey PRIMARY KEY (id, observed_at)",
    "u T_owner_key UNIQUE (source_id, feed, external_id, observed_at)",
  ]);
  const others = rest.filter((d) => !KEYS.test(d));
  expect(on === "ON ONLY" ? others.map((d) => d.replace(" ON ONLY ", " ON ")) : others, name).toEqual(model.filter((d) => !KEYS.test(d)));
}

/**
 * Each state table has a merged view with `mergedColumns(table)`, the tick
 * table none; the grants of each state table and its view are speed_cameras',
 * the tick table's the ingestor's INSERT and SELECT; no reader reads any of them.
 */
export async function expectMergedGrantsReadable<T extends DomainTable>(t: DomainDb, tables: readonly T[], tick: string, mergedColumns: (table: T) => string[]): Promise<void> {
  const states = tables.filter((x) => x.kind === "state");
  for (const table of states) expect((await t.columnsOf(`${table.name}_merged`)).map((x) => x.column_name), table.name).toEqual(mergedColumns(table));
  expect(await t.columnsOf(`${tick}_merged`)).toEqual([]);
  const g = await t.grants([...tables.map((x) => x.name), ...states.map((x) => `${x.name}_merged`), "speed_cameras", "speed_cameras_merged"]);
  for (const table of states) {
    expect(g.get(table.name), table.name).toEqual(g.get("speed_cameras"));
    expect(g.get(`${table.name}_merged`), table.name).toEqual(g.get("speed_cameras_merged"));
  }
  expect(g.get(tick)).toEqual(["viafrei_ingestor:INSERT,SELECT"]);
  const r = await t.readable([...tables.map((x) => `domains.${x.name}`), ...states.map((x) => `domains.${x.name}_merged`)]);
  expect(r.checked).toBe(5 * (tables.length + states.length));
  expect(r.open).toEqual([]);
}
