import path from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

import { testDatabaseUrl } from "./src/test/test-database-url";

loadEnv({ quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts", "scripts/**/*.test.ts"],
    globalSetup: ["src/test/global-setup.ts"],
    // Integration tests share one database; run files one at a time.
    fileParallelism: false,
    env: { TZ: "UTC", DATABASE_URL: testDatabaseUrl() },
  },
});
