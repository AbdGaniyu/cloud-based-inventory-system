import "server-only";

import { verifyToken } from "@/server/notifications/providers/types";

/**
 * Cron routes accept only `Authorization: Bearer $CRON_SECRET` (CLAUDE.md §9). Vercel Cron sends
 * this header automatically when CRON_SECRET is set; scripts/cron-local.ts sends it locally.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") === true && verifyToken(header.slice("Bearer ".length), secret);
}

export async function runCronJob<T extends object>(request: Request, name: string, job: () => Promise<T>): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    if (!process.env.CRON_SECRET) console.error(`Cron ${name} refused: CRON_SECRET is not set`);
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = new Date();
  try {
    const result = await job();
    const body = { job: name, startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime(), ...result };
    console.info(`[cron] ${name}`, JSON.stringify(result));
    return Response.json(body);
  } catch (error) {
    console.error(`[cron] ${name} failed`, error);
    return Response.json({ job: name, error: "Job failed; see server logs" }, { status: 500 });
  }
}
