import { MessageCircle, MessageSquareText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PreferencesForm } from "@/app/(app)/customers/[id]/preferences-form";
import { PrivacyPanel } from "@/app/(app)/customers/[id]/privacy-panel";
import { customerMessages } from "@/app/(app)/ledger/actions";
import { IdentifierChip } from "@/components/identifier-chip";
import { RecordPaymentButton } from "@/components/ledger/record-payment-sheet";
import { Money } from "@/components/money";
import { MessageTimeline } from "@/components/notifications/message-timeline";
import { PageBody } from "@/components/shell/page-body";
import { SectionHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand } from "@/components/summary-band";
import { Badge, InvoiceStatusBadge } from "@/components/ui/status-badge";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getCustomerProfile } from "@/server/services/customer.service";
import { listCustomerMessages } from "@/server/services/message.service";

export const metadata: Metadata = { title: "Customer" };

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const calendar = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const cal = (d: string) => calendar.format(new Date(`${d}T00:00:00Z`));
const WARRANTY_TONE = { ACTIVE: "success", EXPIRED: "neutral", VOID: "danger" } as const;
const WARRANTY_WORD = { ACTIVE: "Active", EXPIRED: "Expired", VOID: "Void" } as const;

export default function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

function OptIn({ on, label, icon: Icon }: { on: boolean; label: string; icon: typeof MessageCircle }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-small", on ? "border-success-border bg-success-bg text-success" : "border-border text-muted-foreground line-through")}>
      <Icon aria-hidden className="size-3.5" /> {label} {on ? "on" : "off"}
    </span>
  );
}

/** Customer profile (DESIGN.md §5.10): plans, purchases, warranties, messages, preferences. */
async function Content({ params }: { params: PageProps<"/customers/[id]">["params"] }) {
  const ctx = await requirePageAccess("customer.view");
  const { id } = await params;
  const customer = await getCustomerProfile(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const messages = can(ctx, "notification.view") ? await listCustomerMessages(ctx, customer.id) : null;
  const activePlans = customer.plans.filter((p) => Number(p.balance) > 0);

  return (
    <>
      <SummaryBand
        title={customer.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body text-muted-foreground tabular-nums">{formatPhoneDisplay(customer.phoneE164)}</span>
            <OptIn on={customer.whatsappOptIn} label="WhatsApp" icon={MessageCircle} />
            <OptIn on={customer.smsOptIn} label="SMS" icon={MessageSquareText} />
          </div>
        }
        items={[
          { label: "Outstanding", value: <Money value={customer.outstanding} />, tone: activePlans.some((p) => p.overdue) ? "danger" : undefined },
          { label: "Lifetime spend", value: <Money value={customer.lifetimeSpend} /> },
          { label: "Purchases", value: customer.purchases.length },
          { label: "Customer since", value: <span className="text-h2">{dateFormat.format(new Date(customer.createdAt))}</span> },
        ]}
      />
      <PageBody className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="plans-heading">
            <SectionHeader id="plans-heading" title="Instalment plans" />
            {customer.plans.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-body text-muted-foreground">No instalment plans.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {customer.plans.map((plan) => (
                  <li key={plan.invoiceId} className={cn("rounded-xl border bg-card p-4", plan.overdue ? "border-danger-border" : "border-border")}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {plan.canView ? (
                          <Link href={`/invoices/${plan.invoiceId}`} className="hover:underline">
                            <IdentifierChip value={plan.number} copyable={false} />
                          </Link>
                        ) : (
                          <IdentifierChip value={plan.number} copyable={false} />
                        )}
                        <span className="text-small text-muted-foreground">{plan.branchName}</span>
                        {plan.overdue ? <Badge tone="danger">Overdue</Badge> : plan.status === "COMPLETED" ? <Badge tone="success">Completed</Badge> : <Badge tone="info">Active</Badge>}
                      </div>
                      {Number(plan.balance) > 0 && can(ctx, "payment.record") && <RecordPaymentButton invoiceId={plan.invoiceId} variant="secondary" size="sm" />}
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`${plan.number} paid`} aria-valuenow={plan.paidPercent} aria-valuemin={0} aria-valuemax={100}>
                      <div className={cn("h-full rounded-full", plan.paidPercent >= 100 ? "bg-success" : plan.overdue ? "bg-danger" : "bg-primary")} style={{ width: `${plan.paidPercent}%` }} />
                    </div>
                    <p className="mt-2 flex flex-wrap justify-between gap-2 text-small text-muted-foreground">
                      <span>
                        Paid <Money value={plan.amountPaid} className="font-medium text-foreground" /> of <Money value={plan.total} /> ({plan.paidPercent}%)
                      </span>
                      <span>
                        Balance <Money value={plan.balance} className="font-medium text-foreground" />
                        {plan.nextDueDate && Number(plan.balance) > 0 && <> · next due {cal(plan.nextDueDate)}</>}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="purchases-heading">
            <SectionHeader id="purchases-heading" title="Purchases" />
            {customer.purchases.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-body text-muted-foreground">No purchases yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {customer.purchases.map((inv) => (
                  <li key={inv.invoiceId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="w-28 text-small text-muted-foreground tabular-nums">{dateFormat.format(new Date(inv.createdAt))}</span>
                    <span className="min-w-0 flex-1">
                      {inv.canView ? (
                        <Link href={`/invoices/${inv.invoiceId}`} className="font-mono text-small hover:underline">
                          {inv.number}
                        </Link>
                      ) : (
                        <span className="font-mono text-small">{inv.number}</span>
                      )}
                      <span className="text-small text-muted-foreground"> · {inv.branchName}</span>
                      <span className="block truncate text-body">{inv.items}</span>
                    </span>
                    <InvoiceStatusBadge status={inv.status} />
                    <Money value={inv.total} className="w-32 text-right font-medium" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {messages && (
            <MessageTimeline subjectId={customer.id} load={customerMessages} initial={messages} canSend={can(ctx, "message.send")} emptyText="No messages sent to this customer yet." />
          )}
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-6">
          {customer.privacy.erasedAt ? (
            <section className="rounded-xl border border-border bg-card p-5 text-body">
              <p className="font-medium">Personal details erased</p>
              <p className="text-small text-muted-foreground">On request, {new Date(customer.privacy.erasedAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })}. Their purchases are kept for tax records; no messages go out.</p>
            </section>
          ) : (
            <>
              <PreferencesForm customerId={customer.id} whatsappOptIn={customer.whatsappOptIn} smsOptIn={customer.smsOptIn} notes={customer.notes} canEdit={can(ctx, "customer.create")} />
              <PrivacyPanel
                customerId={customer.id}
                noticeGivenAt={customer.privacy.noticeGivenAt}
                noticeGivenByName={customer.privacy.noticeGivenByName}
                canRecord={can(ctx, "customer.create")}
                canManage={can(ctx, "customer.privacy")}
                owes={Number(customer.outstanding) > 0}
              />
            </>
          )}
          <section aria-labelledby="warranties-heading" className="rounded-xl border border-border bg-card p-5">
            <h2 id="warranties-heading" className="mb-3 text-h3">Warranties</h2>
            {customer.warranties.length === 0 ? (
              <p className="text-body text-muted-foreground">No devices under warranty.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {customer.warranties.map((w) => (
                  <li key={w.id} className="text-body">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{w.device}</p>
                      <Badge tone={WARRANTY_TONE[w.status]}>{WARRANTY_WORD[w.status]}</Badge>
                    </div>
                    <p className="text-small text-muted-foreground">
                      {w.identifier && <span className="font-mono">{w.identifier}</span>} · until {cal(w.expiresAt)}
                    </p>
                    <a href={`/api/pdf/warranty/${w.id}`} target="_blank" rel="noopener" className="text-small underline-offset-4 hover:underline">
                      Certificate PDF
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </PageBody>
    </>
  );
}
