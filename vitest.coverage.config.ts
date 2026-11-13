import { defineConfig } from "vitest/config";

// Coverage over BOTH layers in one run: the unit suite (vitest.config.ts) and
// the from-empty database run (vitest.db.config.ts), each a project with its
// own timeouts, merged into one report. `npm run coverage`; in CI it runs in
// the Integration tests (PostGIS) job, so the database paths count.
//
// The thresholds are the measured values rounded DOWN (a drop fails the job,
// a rise is written in by hand; measured 2026-11-13: lines 100, branches
// 93.88, functions 100, statements 100). Lines and functions are held at
// 100 %. No file is excluded beyond the tests; three statements carry a
// `v8 ignore next` with their reason beside them (src/cli.ts: the entry-point
// line that runs only when node starts the file; src/server/access.ts and
// src/server/auth.ts: a guard that only narrows a type and cannot be reached).
export default defineConfig({
  test: {
    projects: [
      { extends: "./vitest.config.ts", test: { name: "unit" } },
      { extends: "./vitest.db.config.ts", test: { name: "db" } },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // Tests are not the code under test.
        "src/**/*.test.ts",
      ],
      reporter: ["text-summary", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 100,
        branches: 93.88,
        functions: 100,
        statements: 100,
      },
    },
  },
});
