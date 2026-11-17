import { existsSync } from "node:fs";

/** The smoke test runs against its own database next to the dev one ("_e2e" suffix) on its own port. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export function loadDotEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

export function e2eDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.E2E_DATABASE_URL) return env.E2E_DATABASE_URL;
  if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL (or E2E_DATABASE_URL) to run the smoke test");
  const url = new URL(env.DATABASE_URL);
  // Already the smoke-test URL (the web server passes it down to prepare-db): don't suffix twice.
  if (!url.pathname.endsWith("_e2e")) url.pathname = `${url.pathname.replace(/\/$/, "")}_e2e`;
  return url.toString();
}

/** The smoke-test server runs as a least-privilege login (scripts/db-grant-app-role.ts), proving the app needs no more. */
export const E2E_APP_ROLE = "gadgethub_e2e_app";
export const E2E_APP_PASSWORD = "e2e-app-role-password-only-for-tests";

export function e2eAppDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(e2eDatabaseUrl(env));
  url.username = E2E_APP_ROLE;
  url.password = E2E_APP_PASSWORD;
  return url.toString();
}
