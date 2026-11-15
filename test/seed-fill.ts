/**
 * Rows seeded by type (#32): the catalogue read of a relation's columns and a
 * value of each column's type, so a view test names only the columns its
 * view reads. Shared by test/views-filter.db.test.ts and
 * test/views-merged.db.test.ts.
 */
import type pg from "pg";
import { rows } from "./schema-db.js";

export type Col = { name: string; type: string; typtype: string; notnull: boolean; hasdef: boolean; identity: string; generated: string; label: string | null; pk: number | null };

export const COLS = `
  select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, bt.typtype, a.attnotnull as notnull, a.atthasdef as hasdef,
         a.attidentity as identity, a.attgenerated as generated,
         (select e.enumlabel from pg_enum e where e.enumtypid = bt.oid order by e.enumsortorder limit 1) as label,
         array_position((select i.indkey::int2[] from pg_index i where i.indrelid = a.attrelid and i.indisprimary), a.attnum) as pk
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    join pg_type bt on bt.oid = case when t.typtype = 'd' then t.typbasetype else t.oid end
   where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
   order by a.attnum`;

/** A value of the column's type, distinct per row `n` where the type allows. */
export function fill(c: Col, n: number): string {
  const t = c.type;
  if (c.label !== null) return `'${c.label}'::${t}`;
  if (t.startsWith("geography") || t.startsWith("geometry")) {
    const kind = /\((\w+)/.exec(t)?.[1]?.toLowerCase() ?? "point";
    const x = String(7 + n / 1000);
    const x2 = String(7.01 + n / 1000);
    const wkt = kind.includes("multipolygon")
      ? `MULTIPOLYGON(((${x} 50,${x2} 50,${x2} 50.01,${x} 50)))`
      : kind.includes("polygon")
        ? `POLYGON((${x} 50,${x2} 50,${x2} 50.01,${x} 50))`
        : kind.includes("multilinestring")
          ? `MULTILINESTRING((${x} 50,${x2} 50.01))`
          : kind.includes("linestring")
            ? `LINESTRING(${x} 50,${x2} 50.01)`
            : `POINT(${x} 50)`;
    return `ST_GeomFromText('${wkt}', 4326)::${t}`;
  }
  if (t.endsWith("[]")) return `'{}'::${t}`;
  if (/^(smallint|integer|bigint|numeric|real|double precision)/.test(t)) return `${String(n)}::${t}`;
  if (t === "boolean") return "false";
  if (t.startsWith("timestamp")) return "now()";
  if (t === "date") return "current_date";
  if (t.startsWith("time")) return "'12:00'::" + t;
  if (t === "interval") return "interval '1 hour'";
  if (t === "jsonb" || t === "json") return `'{}'::${t}`;
  if (t === "uuid") return "gen_random_uuid()";
  if (t === "bytea") return `'\\x${n.toString(16).padStart(2, "0")}'::bytea`;
  if (t === "inet" || t === "cidr") return `'10.0.0.${String(n % 250)}'::${t}`;
  if (t === "tstzrange") return "tstzrange(now(), null)";
  if (t === "tstzmultirange") return "'{}'::tstzmultirange";
  const len = /^character(?: varying)?\((\d+)\)/.exec(t)?.[1];
  const v = `v${String(n)}`;
  return `'${len === undefined ? v : v.slice(-Number(len)).padStart(Number(len), "0")}'::${t}`;
}

/**
 * Insert one row into `table`: the columns of `set` as given (SQL
 * expressions), every other NOT NULL column without a default filled by type
 * with `n`. A value given for a generated column is refused, not dropped.
 */
export async function insertRow(c: pg.ClientBase, table: string, set: Readonly<Record<string, string>>, n: number, returning: string): Promise<string> {
  const cols = await rows<Col>(c, COLS, [table]);
  for (const k of Object.keys(set)) {
    const col = cols.find((x) => x.name === k);
    if (col === undefined) throw new Error(`${table}: no column ${k}`);
    if (col.generated !== "") throw new Error(`${table}.${k} is generated; set what it is generated from`);
  }
  const names: string[] = [];
  const values: string[] = [];
  for (const col of cols) {
    if (col.generated !== "") continue;
    const given = set[col.name];
    if (given !== undefined) {
      names.push(col.name);
      values.push(given);
    } else if (col.notnull && !col.hasdef && col.identity === "") {
      names.push(col.name);
      values.push(fill(col, n));
    }
  }
  const r = await rows<{ x: string }>(c, `insert into ${table} (${names.map((x) => `"${x}"`).join(", ")}) values (${values.join(", ")}) returning (${returning})::text as x`);
  return r[0]?.x ?? "";
}
