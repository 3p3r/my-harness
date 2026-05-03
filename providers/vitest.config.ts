import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/**/*.test.ts", "src/**/*.d.ts"],
      thresholds: {
        lines: 90,
        branches: 80,
        functions: 85,
      },
      reportsDirectory: "./coverage",
    },
  },
});
