import { z } from "zod";

import { AGING_BUCKETS, AGING_LABELS } from "@/lib/aging";
import { toCsv } from "@/lib/csv";
import { todayInStoreTz } from "@/lib/dates";
import { getSessionContext } from "@/server/auth/session";
import { documentErrorResponse } from "@/server/documents/access";
import { AGING_EXPORT_LIMIT, payablesAging, receivablesAging } from "@/server/services/aging.service";

const paramsSchema = z.object({
  tab: z.enum(["receivables", "payables"]).catch("receivables"),
  bucket: z.enum(AGING_BUCKETS).optional().catch(undefined),
});

/** Aging report as CSV (DESIGN.md §5.6): the same rows, buckets and permissions as the page. */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Sign in to export reports.", { status: 401 });
  const search = new URL(request.url).searchParams;
  const { tab, bucket } = paramsSchema.parse({ tab: search.get("tab") ?? undefined, bucket: search.get("bucket") ?? undefined });
  const today = todayInStoreTz();
  try {
    const csv =
      tab === "payables"
        ? toCsv(
            ["Purchase order", "Supplier", "Branch", "Due date", "Days overdue", "Bucket", "Balance"],
            (await payablesAging(ctx, { bucket, limit: AGING_EXPORT_LIMIT })).rows.map((r) => [r.number, r.supplierName, r.branchName, r.dueDate, r.daysOverdue, AGING_LABELS[r.bucket], Number(r.amount)]),
          )
        : toCsv(
            ["Invoice", "Instalment", "Customer", "Phone", "Branch", "Due date", "Days overdue", "Bucket", "Amount owed"],
            (await receivablesAging(ctx, { bucket, limit: AGING_EXPORT_LIMIT })).rows.map((r) => [
              r.number,
              r.sequence,
              r.customerName,
              r.customerPhone,
              r.branchName,
              r.dueDate,
              r.daysOverdue,
              AGING_LABELS[r.bucket],
              Number(r.amount),
            ]),
          );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${tab}-aging-${bucket ?? "all"}-${today}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
