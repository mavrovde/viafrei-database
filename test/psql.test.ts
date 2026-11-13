import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { percentDecode, PSQL_FLAGS, psqlInvocation, psqlRunner, splitPassword } from "../src/psql.js";

describe("splitPassword", () => {
  it.each([
    ["postgresql://u:pw@h:5432/db", "postgresql://u@h:5432/db", "pw"],
    ["postgresql://u:p%40ss%3Aw@h/db", "postgresql://u@h/db", "p@ss:w"],
    ["postgresql://u:a@b@h/db", "postgresql://u@h/db", "a@b"],
    ["postgres://u:pw@h", "postgres://u@h", "pw"],
    ["postgresql://u:pw@h/db?sslmode=require", "postgresql://u@h/db?sslmode=require", "pw"],
  ])("takes the password out of %s", (url, rest, pw) => {
    expect(splitPassword(url)).toEqual({ url: rest, password: pw });
  });

  it.each(["postgresql://u@h/db", "postgresql://u:@h/db", "postgresql://h/db", "host=h user=u"])("leaves %s untouched (no password to take)", (url) => {
    expect(splitPassword(url)).toEqual({ url, password: null });
  });
});

describe("percentDecode", () => {
  it("decodes %HH bytes as UTF-8 and leaves a malformed escape literal", () => {
    expect(percentDecode("%C3%A4b")).toBe("äb");
    expect(percentDecode("100%")).toBe("100%");
    expect(percentDecode("%4")).toBe("%4");
    expect(percentDecode("%zz%41")).toBe("%zzA");
    expect(percentDecode("%41")).toBe("A");
  });
});

describe("psqlInvocation", () => {
  it("puts the password in PGPASSWORD and never in argv, and drops the caller's PGPASSWORD", () => {
    const c = psqlInvocation({ databaseUrl: "postgresql://u:s3cret@h/db", env: { PGPASSWORD: "other", PATH: "/bin" } }, ["-c", "select 1"]);
    expect(c.args).toEqual(["postgresql://u@h/db", ...PSQL_FLAGS, "-c", "select 1"]);
    expect(c.args.join(" ")).not.toContain("s3cret");
    expect(c.env["PGPASSWORD"]).toBe("s3cret");
    expect(c.env["PATH"]).toBe("/bin");
  });

  it("forwards no PGPASSWORD at all when the url carries none", () => {
    expect(psqlInvocation({ databaseUrl: "postgresql://u@h/db", env: { PGPASSWORD: "other" } }, []).env).not.toHaveProperty("PGPASSWORD");
  });

  it("does not touch the environment object it was given", () => {
    const env = { PGPASSWORD: "other" };
    psqlInvocation({ databaseUrl: "postgresql://u:x@h/db", env }, []);
    expect(env).toEqual({ PGPASSWORD: "other" });
  });
});

describe("psqlRunner", () => {
  it("runs the binary with stdin, and reports its exit code and output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vfdb-psql-"));
    try {
      const bin = join(dir, "psql");
      writeFileSync(bin, `#!/bin/sh\ncat > "${dir}/stdin"\necho "out:$PGPASSWORD"\necho err >&2\nexit 3\n`);
      chmodSync(bin, 0o755);
      const r = await psqlRunner({ databaseUrl: "postgresql://u:pw@h/db", bin, env: {} })("select 1;\n");
      expect(r).toEqual({ code: 3, stdout: "out:pw\n", stderr: "err\n" });
      expect(readFileSync(join(dir, "stdin"), "utf8")).toBe("select 1;\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers 127 with a reason when the binary cannot be started", async () => {
    const r = await psqlRunner({ databaseUrl: "postgresql://u@h/db", bin: "/nonexistent/psql" })("");
    expect(r.code).toBe(127);
    expect(r.stderr).toContain("psql could not be started");
  });

  it("a binary that exits without reading its stdin is judged by its exit code, not by the broken pipe", async () => {
    const r = await psqlRunner({ databaseUrl: "postgresql://u@h/db", bin: "/usr/bin/true", env: {} })(Buffer.alloc(4 << 20, 0x20));
    expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  // The test above cannot promise a broken pipe: Node destroys a child's stdin
  // when the child exits, so whether the write fails with EPIPE first or the
  // stream is simply closed depends on timing (on a loaded runner the second
  // won, and the stdin error handler went uncovered). Here the child closes its
  // stdin and stays alive, so the write breaks while it runs, every time.
  it("a broken pipe while the binary still runs is swallowed, and the exit code decides", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vfdb-psql-"));
    try {
      const bin = join(dir, "psql");
      writeFileSync(bin, `#!/bin/sh\nexec 0<&-\nsleep 0.5\necho done\nexit 4\n`);
      chmodSync(bin, 0o755);
      const r = await psqlRunner({ databaseUrl: "postgresql://u@h/db", bin, env: {} })(Buffer.alloc(4 << 20, 0x20));
      expect(r).toEqual({ code: 4, stdout: "done\n", stderr: "" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
