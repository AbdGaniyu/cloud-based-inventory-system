import { BellRing } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { EmptyState } from "@/components/empty-state";
import { FilterChips } from "@/components/filter-chips";
import { NotificationList } from "@/components/notifications/notification-list";
import { Pagination } from "@/components/pagination";
import { ParamSelect } from "@/components/param-select";
import { SearchInput } from "@/components/search-input";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { isTemplateKey, TEMPLATE_KEYS, TEMPLATE_LABELS } from "@/server/notifications/templates";
import { listNotifications } from "@/server/services/message.service";

export const metadata: Metadata = { title: "Notifications" };

const STATUSES = ["FAILED", "QUEUED", "SENT", "DELIVERED", "SKIPPED"] as const;
const STATUS_LABEL = { FAILED: "Failed", QUEUED: "Queued", SENT: "Sent", DELIVERED: "Delivered", SKIPPED: "Not sent" } as const;

const paramsSchema = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  channel: z.enum(["WHATSAPP", "SMS"]).optional().catch(undefined),
  template: z.string().refine(isTemplateKey).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export default function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

/** Notification centre (CLAUDE.md §9). */
async function Content({ searchParams }: { searchParams: PageProps<"/notifications">["searchParams"] }) {
  const ctx = await requirePageAccess("notification.view");
  const raw = await searchParams;
  const p = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const list = await listNotifications(ctx, p);
  const keep = new URLSearchParams(Object.entries({ channel: p.channel, template: p.template, q: p.q }).filter((e): e is [string, string] => Boolean(e[1])));
  const href = (status?: string) => {
    const s = new URLSearchParams(keep);
    if (status) s.set("status", status);
    const q = s.toString();
    return q ? `/notifications?${q}` : "/notifications";
  };

  return (
    <PageBody className="flex flex-col gap-4">
      <FilterChips
        label="Message status"
        items={[{ label: "All", count: list.counts.ALL, href: href(), active: !p.status }, ...STATUSES.map((s) => ({ label: STATUS_LABEL[s], count: list.counts[s], href: href(s), active: p.status === s }))]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-72">
          <SearchInput placeholder="Customer, phone or invoice" label="Search messages" />
        </div>
        <ParamSelect param="channel" label="Filter by channel" anyLabel="WhatsApp and SMS" options={[{ value: "WHATSAPP", label: "WhatsApp" }, { value: "SMS", label: "SMS" }]} />
        <ParamSelect param="template" label="Filter by message" anyLabel="Every message" options={TEMPLATE_KEYS.map((k) => ({ value: k, label: TEMPLATE_LABELS[k] }))} />
      </div>
      {list.rows.length === 0 ? (
        <EmptyState icon={BellRing} title="No messages here" description="Receipts, warranty cards, reminders and confirmations appear here as they are sent." />
      ) : (
        <NotificationList rows={list.rows} canSend={can(ctx, "message.send")} />
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} noun="messages" params={{ status: p.status, channel: p.channel, template: p.template, q: p.q }} />
    </PageBody>
  );
}
