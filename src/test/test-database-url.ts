/** Integration tests use their own database next to the dev one (same server, "_test" suffix). */
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL or TEST_DATABASE_URL to run tests");
  const url = new URL(env.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/\/$/, "")}_test`;
  return url.toString();
}
