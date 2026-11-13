import { defineConfig } from "vitest/config";

// The unit suite: no database, no network, no docker. Every case is held to the
// two-second ceiling; the one from-empty migration run lives in vitest.db.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/*.db.test.ts", "node_modules/**", "dist/**"],
    testTimeout: 2000,
    hookTimeout: 2000,
  },
});
