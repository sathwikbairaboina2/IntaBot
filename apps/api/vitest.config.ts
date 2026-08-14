import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup-env.ts"],
    hookTimeout: 30_000,
    // DynamoDB Local is shared state; parallel files would race on
    // resetTables(). Run test files one at a time.
    fileParallelism: false,
  },
});
