import { connection } from "next/server";

import { healthReport } from "@/server/ops/jobs";

/**
 * Health check for the host and uptime monitors: 200 while the database answers (status "ok", or
 * "degraded" when a scheduled job is stale or failing), 503 when it does not. Nothing sensitive.
 */
export async function GET() {
  await connection();
  const report = await healthReport();
  return Response.json(report, { status: report.database === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
