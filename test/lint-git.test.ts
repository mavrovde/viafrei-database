/**
 * fsIo's git seams over a real throwaway repository: the three answers of
 * base() and the blob ids baseBlob() reads from origin/main.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fsIo, gitBlobId, lint, type LintIo } from "../src/lint/check-migrations.js";
import { plantTree } from "./helpers.js";

const OK1 = "create table a(id int);\n-- rollback: drop table a; delete from schema_migrations where version = 1;\n";
const saved = process.env["GIT_CEILING_DIRECTORIES"];
let done: (() => void) | null = null;
afterEach(() => {
  done?.();
  done = null;
  if (saved === undefined) delete process.env["GIT_CEILING_DIRECTORIES"];
  else process.env["GIT_CEILING_DIRECTORIES"] = saved;
});

const git = (root: string, ...args: string[]): void => void execFileSync("git", ["-C", root, "-c", "user.email=t@example.org", "-c", "user.name=t", ...args], { stdio: "ignore" });

describe("fsIo against git", () => {
  it("base(): not a checkout, then no origin, then an origin without origin/main (refused), then ok; baseBlob reads origin/main", () => {
    const t = plantTree({ "0001_a.sql": OK1 });
    done = t.done;
    // The tree must not be found inside whatever repository holds the temp directory.
    process.env["GIT_CEILING_DIRECTORIES"] = dirname(t.root);
    const io = fsIo(t.root);
    expect(io.base()).toEqual({ kind: "absent", note: "not a git checkout, so rule 4 (already applied and EDITED) has no base here" });
    git(t.root, "init", "-q");
    expect(io.base()).toEqual({ kind: "absent", note: "no 'origin' remote, so rule 4 (already applied and EDITED) has no base here" });
    git(t.root, "remote", "add", "origin", "/nonexistent");
    expect(io.base()).toEqual({ kind: "refuse" });
    git(t.root, "add", "db");
    git(t.root, "commit", "-q", "-m", "a");
    git(t.root, "update-ref", "refs/remotes/origin/main", "HEAD");
    expect(io.base()).toEqual({ kind: "ok" });
    expect(io.baseBlob("migrations", "0001_a.sql")).toBe(gitBlobId(readFileSync(join(t.dir, "0001_a.sql"))));
    expect(io.baseBlob("migrations", "0002_b.sql")).toBeNull();
    expect(io.baseBlob("baseline", "ledger.tsv")).toBeNull();
    expect(lint(io).exitCode).toBe(0);
  });
});

describe("the lint's other edges", () => {
  it("passes a checkout that has no db/migrations and no db/baseline yet", () => {
    const t = plantTree({});
    done = t.done;
    rmSync(t.dir, { recursive: true });
    expect(lint(fsIo(t.root))).toEqual({ exitCode: 0, lines: ["✓ no db/migrations directory yet"] });
  });

  it("does not turn an unexpected read error of ledger.tsv into a lint finding", () => {
    const io: LintIo = {
      list: (d) => (d === "baseline" ? ["ledger.tsv", "0001_baseline.sql"] : []),
      read: () => {
        throw new Error("EIO: i/o error");
      },
      base: () => ({ kind: "ok" }),
      baseBlob: () => null,
    };
    expect(() => lint(io)).toThrow("EIO");
  });
});
