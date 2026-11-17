import { History } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { AuditTable, DateRangeFilter } from "@/components/audit/audit-table";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { ParamSelect } from "@/components/param-select";
import { SearchInput } from "@/components/search-input";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { parseCalendarDate } from "@/lib/dates";
import { calendarDateString } from "@/lib/validators/common";
import { requirePageAccess } from "@/server/auth/session";
import { db } from "@/server/db";
import { listAuditLogs } from "@/server/services/audit-log.service";

export const metadata: Metadata = { title: "Audit log" };

const paramsSchema = z.object({
  user: z.guid().optional().catch(undefined),
  branch: z.guid().optional().catch(undefined),
  action: z.string().max(60).optional().catch(undefined),
  from: calendarDateString.optional().catch(undefined),
  to: calendarDateString.optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

/** Audit log (DESIGN.md §5.12): read-only, filterable; no edit or delete controls anywhere. */
async function Content({ searchParams }: { searchParams: PageProps<"/audit">["searchParams"] }) {
  const ctx = await requirePageAccess("audit.view");
  const raw = await searchParams;
  const p = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const log = await listAuditLogs(ctx, { userId: p.user, branchId: p.branch, action: p.action, from: p.from ? parseCalendarDate(p.from) : undefined, to: p.to ? parseCalendarDate(p.to) : undefined, q: p.q, page: p.page });
  const groups = [...new Set(log.actions.map((a) => `${a.split(".")[0]}.`))];
  const branches = ctx.role === "OWNER" && !ctx.activeBranchId ? await db.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : null;

  return (
    <PageBody className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-72">
          <SearchInput placeholder="Invoice, PO or return number, email" label="Search the audit log" />
        </div>
        <ParamSelect param="user" label="Filter by person" anyLabel="Everyone" options={log.users.map((u) => ({ value: u.id, label: u.name }))} />
        {branches && <ParamSelect param="branch" label="Filter by branch" anyLabel="All branches" options={branches.map((b) => ({ value: b.id, label: b.name }))} />}
        <ParamSelect
          param="action"
          label="Filter by action"
          anyLabel="All actions"
          options={[...groups.map((g) => ({ value: g, label: `${g}* (all)` })), ...log.actions.map((a) => ({ value: a, label: a }))]}
        />
        <DateRangeFilter from={p.from} to={p.to} />
      </div>
      {log.rows.length === 0 ? (
        <EmptyState icon={History} title="Nothing recorded for these filters" description="Every change to stock, money, users and settings is written here." />
      ) : (
        <AuditTable rows={log.rows} />
      )}
      <Pagination page={log.page} pageSize={log.pageSize} total={log.total} noun="entries" params={{ user: p.user, branch: p.branch, action: p.action, from: p.from, to: p.to, q: p.q }} />
    </PageBody>
  );
}
