/**
 * db/baseline/aliases.tsv: the other checksum a ledger may hold for a
 * baseline version whose file was edited (in its comments only) after the
 * baseline was cut. Parsed against ledger.tsv, accepted by migrate, readiness
 * and ledger-compare, and refused for any third checksum.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ALIASES_HEADER, assembleSchema, loadSchema, BaselineError, baselineEntry, compareLedgerExport, LEDGER_HEADER, parseAliasesTsv, parseLedgerTsv, readBaseline, type Baseline } from "../src/migrations/baseline.js";
import { acceptsChecksum, describeFile, sha256Hex } from "../src/migrations/files.js";
import { migrate } from "../src/migrations/migrate.js";
import { compare } from "../src/migrations/plan.js";
import { lint, type LintIo } from "../src/lint/check-migrations.js";
import { fakePsql, REPO } from "./helpers.js";

const sum = (n: number): string => sha256Hex(Buffer.from(`original ${String(n)}`));
const edited = (n: number): string => sha256Hex(Buffer.from(`edited ${String(n)}`));
const name = (n: number): string => `${String(n).padStart(4, "0")}_m${String(n)}.sql`;
const tsv = (n: number): string => `${LEDGER_HEADER}\n${Array.from({ length: n }, (_, i) => `${String(i + 1)}\t${name(i + 1)}\t${sum(i + 1)}`).join("\n")}\n`;
const alias = (n: number, checksum = edited(n), reason = "comments edited after the cut"): string => `${String(n)}\t${name(n)}\t${checksum}\t${reason}`;
const aliases = (...lines: string[]): string => `${ALIASES_HEADER}\n${lines.join("\n")}\n`;
const DUMP = "create table a(id int);\n";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const plant = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "vf-aliases-"));
  dirs.push(root);
  for (const [n, c] of Object.entries(files)) writeFileSync(join(root, n), c);
  return root;
};
const withAliases = (head: number, text: string): Baseline => {
  const b = readBaseline(plant({ "ledger.tsv": tsv(head), [`${String(head).padStart(4, "0")}_baseline.sql`]: DUMP, "aliases.tsv": text }));
  if (b === null) throw new Error("no baseline");
  return b;
};

describe("parseAliasesTsv", () => {
  const rows = parseLedgerTsv(tsv(3));

  it("maps each version to its other checksums, in file order", () => {
    const m = parseAliasesTsv(aliases(alias(2), alias(3), alias(2, sum(9))), rows);
    expect([...m.entries()]).toEqual([
      [2, [edited(2), sum(9)]],
      [3, [edited(3)]],
    ]);
  });

  it.each([
    ["a wrong header", "version\tname\tchecksum\n", "the first line must be"],
    ["three columns", aliases(`2\t${name(2)}\t${edited(2)}`), "line 2: expected 4 tab-separated columns, got 3"],
    ["a version that is no number", aliases(`x\t${name(2)}\t${edited(2)}\tr`), "'x' is not a version of ledger.tsv"],
    ["a version past the ledger", aliases(alias(4)), "'4' is not a version of ledger.tsv"],
    ["another name", aliases(`2\t0002_other.sql\t${edited(2)}\tr`), "version 2 is 0002_m2.sql in ledger.tsv, not '0002_other.sql'"],
    ["a bad checksum", aliases(alias(2, "X".repeat(64))), "64 lower-case hex"],
    ["ledger.tsv's own checksum", aliases(alias(2, sum(2))), "version 2 already stands for that checksum"],
    ["the same alias twice", aliases(alias(2), alias(2)), "line 3: version 2 already stands for that checksum"],
    ["no reason", aliases(alias(2, edited(2), "  ")), "an alias needs its reason"],
    ["no rows", `${ALIASES_HEADER}\n`, "no rows; delete the file instead"],
  ])("refuses %s", (_n, text, msg) => {
    expect(() => parseAliasesTsv(text, rows)).toThrow(BaselineError);
    expect(() => parseAliasesTsv(text, rows)).toThrow(msg);
  });
});

describe("a baseline with aliases", () => {
  it("readBaseline attaches them to their entries, and only to them", () => {
    const b = withAliases(3, aliases(alias(2)));
    expect(b.entries.map((e) => e.aliases ?? null)).toEqual([null, [edited(2)], null]);
    expect(baselineEntry(parseLedgerTsv(tsv(1))[0] ?? { version: 1, name: name(1), checksum: sum(1) })).not.toHaveProperty("aliases");
  });

  it("readBaseline refuses an aliases.tsv that does not parse", () => {
    const dir = plant({ "ledger.tsv": tsv(2), "0002_baseline.sql": DUMP, "aliases.tsv": aliases(alias(5)) });
    expect(() => readBaseline(dir)).toThrow("'5' is not a version of ledger.tsv");
  });

  it("acceptsChecksum takes the own checksum or an alias, nothing else", () => {
    const e = { checksum: sum(2), aliases: [edited(2)] };
    expect([acceptsChecksum(e, sum(2)), acceptsChecksum(e, edited(2)), acceptsChecksum(e, sum(9)), acceptsChecksum({ checksum: sum(2) }, edited(2))]).toEqual([true, true, false, false]);
  });

  it("readiness counts an aliased row as applied and a third checksum as a mismatch", () => {
    const b = withAliases(2, aliases(alias(2)));
    const ok = compare(b.entries, [
      { version: 1, checksum: sum(1) },
      { version: 2, checksum: edited(2) },
    ]);
    expect([ok.applied, ok.mismatches]).toEqual([2, []]);
    const bad = compare(b.entries, [
      { version: 1, checksum: sum(1) },
      { version: 2, checksum: sum(9) },
    ]);
    expect(bad.mismatches.map((m) => m.version)).toEqual([2]);
  });

  it("migrate goes past an aliased row and stops on a third checksum", async () => {
    const b = withAliases(2, aliases(alias(2)));
    const after = describeFile("0003_c.sql", Buffer.from("select 1;\n"));
    const run = async (two: string): Promise<{ code: number; applied: readonly string[]; lines: readonly string[] }> => {
      const p = fakePsql({ ledger: [`1 ${sum(1)}`, `2 ${two}`] });
      const lines: string[] = [];
      const r = await migrate({ psql: p.run, files: [after], baseline: b, lockPauseS: 0, out: (l) => lines.push(l), err: (l) => lines.push(l) });
      return { code: r.exitCode, applied: r.applied, lines: [...lines, r.message] };
    };
    const ok = await run(edited(2));
    expect([ok.code, ok.applied]).toEqual([0, ["0003_c.sql"]]);
    const bad = await run(sum(9));
    expect(bad.code).toBe(1);
    expect(bad.lines.join("\n")).toContain("0002_m2.sql is applied with a different checksum than the baseline's ledger.tsv or a recorded alias");
  });

  it("ledger-compare counts an aliased row as equal and says how many", () => {
    const b = withAliases(2, aliases(alias(2)));
    const r = compareLedgerExport(b, `1\t${name(1)}\t${sum(1)}\n2\t${name(2)}\t${edited(2)}\n`);
    expect(r).toEqual({ exitCode: 0, lines: ["✓ the export holds all 2 versions of ledger.tsv with equal names and checksums (1 by a recorded alias in aliases.tsv)"] });
  });
});

describe("ledger-compare and the carried tail", () => {
  const head3 = (): Baseline => {
    const b = readBaseline(plant({ "ledger.tsv": tsv(3), "0003_baseline.sql": DUMP }));
    if (b === null) throw new Error("no baseline");
    return assembleSchema(b, [describeFile(name(3), Buffer.from("original 3"))]).baseline ?? b;
  };

  it("an export that stops before a carried tail is clean, the tail named pending", () => {
    const r = compareLedgerExport(head3(), `1\t${name(1)}\t${sum(1)}\n2\t${name(2)}\t${sum(2)}\n`);
    expect(r).toEqual({ exitCode: 0, lines: ["✓ the export holds versions 1..2 of ledger.tsv with equal names and checksums; 0003_m3.sql pending, carried as file(s) that migrate applies"] });
  });

  it("a missing version the image does not carry is still a difference", () => {
    const r = compareLedgerExport(head3(), `1\t${name(1)}\t${sum(1)}\n`);
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual(["  ✗ version 2 (0002_m2.sql): not in the export", "  ✗ version 3 (0003_m3.sql): not in the export", "✗ 2 of the baseline's 3 versions differ from the export"]);
  });

  it("a gap below what the export holds is a difference even when the tail is carried", () => {
    const r = compareLedgerExport(head3(), `1\t${name(1)}\t${sum(1)}\n3\t${name(3)}\t${sum(3)}\n`);
    expect(r.lines).toEqual(["  ✗ version 2 (0002_m2.sql): not in the export", "✗ 1 of the baseline's 3 versions differ from the export"]);
  });
});

describe("the lint and aliases.tsv", () => {
  const planted = (baseline: Record<string, string>): LintIo => ({
    list: (d) => (d === "baseline" ? Object.keys(baseline) : []),
    read: (d, n) => Buffer.from(d === "baseline" ? (baseline[n] ?? "") : ""),
    base: () => ({ kind: "absent", note: "no 'origin' remote" }),
    baseBlob: () => null,
  });

  it("passes a valid aliases.tsv and names an invalid one", () => {
    expect(lint(planted({ "ledger.tsv": tsv(3), "0003_baseline.sql": DUMP, "aliases.tsv": aliases(alias(2)) })).exitCode).toBe(0);
    const r = lint(planted({ "ledger.tsv": tsv(3), "0003_baseline.sql": DUMP, "aliases.tsv": aliases(alias(2, sum(2))) }));
    expect(r.lines.filter((l) => l.startsWith("  ✗ "))).toEqual(["  ✗ db/baseline/aliases.tsv line 2: version 2 already stands for that checksum"]);
  });

  it("judges aliases.tsv only against a readable ledger, and lets an unreadable file's error through", () => {
    const r = lint(planted({ "ledger.tsv": "not a ledger\n", "0003_baseline.sql": DUMP, "aliases.tsv": aliases(alias(2)) }));
    expect(r.lines.filter((l) => l.startsWith("  ✗ db/baseline/aliases"))).toEqual([]);
    const io = planted({ "ledger.tsv": tsv(3), "0003_baseline.sql": DUMP, "aliases.tsv": "" });
    const broken: LintIo = {
      ...io,
      read: (d, n) => {
        if (n === "aliases.tsv") throw new Error("EIO");
        return io.read(d, n);
      },
    };
    expect(() => lint(broken)).toThrow("EIO");
  });
});

describe("the shipped aliases.tsv", () => {
  it("names exactly 0288..0292, each under ledger.tsv's name, with a reason", () => {
    const rows = parseLedgerTsv(readFileSync(join(REPO, "db", "baseline", "ledger.tsv"), "utf8"));
    const m = parseAliasesTsv(readFileSync(join(REPO, "db", "baseline", "aliases.tsv"), "utf8"), rows);
    expect([...m.keys()]).toEqual([288, 289, 290, 291, 292]);
    expect([...m.values()].every((v) => v.length === 1)).toBe(true);
  });

  it("makes the export of a database migrated file by file to 0292 compare clean, 0293 pending", () => {
    const b = loadSchema(join(REPO, "db", "migrations"), join(REPO, "db", "baseline")).baseline;
    if (b === null) throw new Error("no baseline");
    const r = compareLedgerExport(b, readFileSync(join(REPO, "test", "ledger-at-0292.tsv"), "utf8"));
    expect(r).toEqual({
      exitCode: 0,
      lines: ["✓ the export holds versions 1..292 of ledger.tsv with equal names and checksums (5 by a recorded alias in aliases.tsv); 0293_neutral_texts.sql pending, carried as file(s) that migrate applies"],
    });
  });
});
