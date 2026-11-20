/**
 * The name PostgreSQL gives the index a partition inherits from its parent
 * (#31 item 8). `partitions ensure` creates a day as `CREATE TABLE <t>_YYYYMMDD
 * PARTITION OF <t>`, and the server names every index it clones there itself —
 * the rule of ChooseRelationName/ChooseIndexName (src/backend/commands/indexcmds.c):
 *
 *   primary key        <partition>_pkey
 *   unique constraint  <partition>_<columns>_key
 *   exclusion          <partition>_<columns>_excl
 *   any other index    <partition>_<columns>_idx
 *
 * <columns> is the key's column names joined by `_` (an expression is named as
 * FigureColname names it: a function call by the function, a cast of a column
 * by the column — `(geom)::geometry` is `geom` — any other expression `expr`),
 * and the whole is cut to 63 bytes by shortening the longer of the two parts
 * (makeObjectName). When two of one partition's indexes share a name, the second
 * takes `1` after the label (`_idx1`), the third `2`, in the order they are
 * cloned. So a partition index name is a function of the partition's name and
 * the parent index's shape, and nothing else: deterministic, and documented in
 * README.md (Partitions).
 */

const NAMEDATALEN = 64;

/** makeObjectName: name1[_name2]_label within 63 bytes, the longer part shortened first. */
export function makeObjectName(name1: string, name2: string | null, label: string): string {
  let n1 = name1.length;
  let n2 = name2 === null ? 0 : name2.length;
  const overhead = (label === "" ? 0 : label.length + 1) + (name2 === null ? 0 : 1);
  while (n1 + n2 + overhead >= NAMEDATALEN) {
    if (n1 > n2) n1 -= 1;
    else n2 -= 1;
  }
  return [name1.slice(0, n1), ...(name2 === null ? [] : [name2.slice(0, n2)]), ...(label === "" ? [] : [label])].join("_");
}

/** ChooseIndexNameAddition: the column names joined by `_`, stopped once past 63 bytes. */
export function nameAddition(columns: readonly string[]): string {
  let out = "";
  for (const c of columns) {
    if (out !== "") out += "_";
    out += c;
    if (out.length >= NAMEDATALEN - 1) break;
  }
  return out.slice(0, NAMEDATALEN - 1);
}

export type IndexKind = "pkey" | "key" | "excl" | "idx";

/** The base name (before any collision number) of a partition's clone of a parent index. */
export function partitionIndexName(partition: string, kind: IndexKind, columns: readonly string[]): string {
  return kind === "pkey" ? makeObjectName(partition, null, "pkey") : makeObjectName(partition, nameAddition(columns), kind);
}

/** The name with collision number n (0 = none): the number is appended to the label, and the label kept within 63 bytes. */
export function numbered(partition: string, kind: IndexKind, columns: readonly string[], n: number): string {
  if (n === 0) return partitionIndexName(partition, kind, columns);
  const label = `${kind}${String(n)}`;
  return kind === "pkey" ? makeObjectName(partition, null, label) : makeObjectName(partition, nameAddition(columns), label);
}
