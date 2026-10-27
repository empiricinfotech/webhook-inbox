import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    maxWorkers: 2,
    passWithNoTests: false,
    allowOnly: false,
    projects: [
      { test: { name: "unit", environment: "node", include: ["tests/unit/**/*.test.ts"],
        isolate: true, restoreMocks: true, unstubEnvs: true } },
      { test: { name: "api", environment: "node", include: ["tests/api/**/*.test.ts"],
        isolate: true, fileParallelism: false, testTimeout: 20000, hookTimeout: 20000,
        restoreMocks: true, unstubEnvs: true } },
    ],
  },
});
