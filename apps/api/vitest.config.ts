import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // setup-env.ts derives a per-worker DynamoDB table name, which is what
    // isolates concurrent test files from each other.
    setupFiles: ["./test/setup-env.ts"],
    hookTimeout: 30_000,
  },
});
