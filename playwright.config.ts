import { defineConfig, devices } from "@playwright/test";

import { E2E_BASE_URL, E2E_PORT, e2eAppDatabaseUrl, e2eDatabaseUrl, loadDotEnv } from "./tests/e2e/e2e-env";

loadDotEnv();

/**
 * Checkout smoke test (CLAUDE.md §13). The web server recreates and seeds its own "_e2e" database,
 * builds the app and serves it on port 3100, so it never touches dev data and can run beside `pnpm dev`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    // prepare-db runs as the owner (DATABASE_URL below); the app is built and served as the least-privilege login.
    command: `pnpm exec tsx tests/e2e/prepare-db.ts && DATABASE_URL='${e2eAppDatabaseUrl()}' pnpm build && DATABASE_URL='${e2eAppDatabaseUrl()}' pnpm exec next start -p ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      APP_URL: E2E_BASE_URL,
      NEXTAUTH_URL: E2E_BASE_URL,
      WHATSAPP_PROVIDER: "console",
      SMS_PROVIDER: "console",
    },
  },
});
