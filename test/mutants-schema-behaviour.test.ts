import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEMA_BEHAVIOUR_MUTANTS } from "../scripts/mutants-schema-behaviour.js";

describe("the schema behaviour mutants", () => {
  it("each plants a change at exactly one place of its file, under a name of its own", () => {
    const texts = new Map<string, string>();
    const bad: string[] = [];
    for (const m of SCHEMA_BEHAVIOUR_MUTANTS) {
      const text = texts.get(m.file) ?? readFileSync(m.file, "utf8");
      texts.set(m.file, text);
      const n = text.split(m.from).length - 1;
      if (n !== 1 || m.from === m.to) bad.push(`${m.name}: found ${String(n)} time(s)`);
    }
    expect(bad).toEqual([]);
    expect(new Set(SCHEMA_BEHAVIOUR_MUTANTS.map((m) => m.name)).size).toBe(SCHEMA_BEHAVIOUR_MUTANTS.length);
    expect(SCHEMA_BEHAVIOUR_MUTANTS.every((m) => m.tests.length > 0 && m.tests.every((t) => t.endsWith(".db.test.ts")))).toBe(true);
  });
});
