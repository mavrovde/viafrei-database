import { defineConfig } from "vitest/config";

// The database layer: one explicit from-empty migration run against a throwaway
// PostGIS (TEST_DATABASE_URL). It is the one case allowed past the two-second
// ceiling: the baseline from empty takes tens of seconds, measured in the PR.
export default defineConfig({
  test: {
    include: ["test/**/*.db.test.ts"],
    testTimeout: 900_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
