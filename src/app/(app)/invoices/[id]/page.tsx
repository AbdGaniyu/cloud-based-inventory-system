import { Download, ExternalLink, Printer, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { IdentifierChip } from "@/components/identifier-chip";
import { MessageTimeline } from "@/components/notifications/message-timeline";
import { Money } from "@/components/money";
import { PageBody } from "@/components/shell/page-body";
import { SectionHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand } from "@/components/summary-band";
import { Button } from "@/components/ui/button";
import { Badge, ConditionBadge, InvoiceStatusBadge, ScheduleStatusBadge } from "@/components/ui/status-badge";
import { addDays, todayInStoreTz } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getInvoiceDocument } from "@/server/services/document.service";
import { listInvoiceMessages } from "@/server/services/message.service";

export const metadata: Metadata = { title: "Invoice" };

const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const calendar = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const cal = (d: string) => calendar.format(new Date(`${d}T00:00:00Z`));
const METHOD = { CASH: "Cash", BANK_TRANSFER: "Bank transfer", POS_CARD: "POS card" } as const;
const KIND = { CHECKOUT: "At sale", DOWN_PAYMENT: "Down payment", INSTALLMENT: "Instalment", REFUND: "Refund" } as const;
const DUE_SOON_DAYS = 3;

export default function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between py-1", strong && "border-t border-border pt-2 font-semibold")}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Invoice detail (DESIGN.md §5.3), read-only for now: payments, reminders, returns and void arrive in later steps. */
async function Content({ params }: { params: PageProps<"/invoices/[id]">["params"] }) {
  const ctx = await requirePageAccess("invoice.view");
  const { id } = await params;
  const invoice = await getInvoiceDocument(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const messages = can(ctx, "notification.view") ? await listInvoiceMessages(ctx, invoice.id) : null;
  const today = todayInStoreTz();
  const overdue = invoice.displayStatus === "OVERDUE";
  const warranties = invoice.items.filter((i) => i.warranty);

  return (
    <>
      <SummaryBand
        title={`Invoice ${invoice.number}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={invoice.displayStatus} />
            <Button asChild variant="secondary">
              <Link href={`/print/receipt/${invoice.id}`} target="_blank" rel="noopener">
                <Printer aria-hidden data-icon="inline-start" /> Print receipt
              </Link>
            </Button>
            <Button asChild>
              <a href={`/api/pdf/invoice/${invoice.id}`} target="_blank" rel="noopener">
                <Download aria-hidden data-icon="inline-start" /> Download PDF
              </a>
            </Button>
          </div>
        }
        items={[
          { label: "Customer", value: <span className="text-h2">{invoice.customer.name}</span>, sub: formatPhoneDisplay(invoice.customer.phoneE164) },
          { label: "Branch", value: <span className="text-h2">{invoice.branch.name}</span>, sub: `Served by ${invoice.cashierName}` },
          { label: "Date", value: <span className="text-h2">{dateTime.format(new Date(invoice.createdAt))}</span>, sub: invoice.paymentType === "INSTALLMENT" ? "Installment sale" : "Paid in full at sale" },
          { label: "Total", value: <Money value={invoice.total} /> },
          { label: "Balance", value: <Money value={invoice.balance} tone={overdue ? "danger" : undefined} />, tone: overdue ? "danger" : undefined, sub: invoice.plan?.nextDueDate ? `Next due ${cal(invoice.plan.nextDueDate)}` : undefined },
        ]}
      />
      <PageBody className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="items-heading">
            <SectionHeader title="Items" />
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-small">
                <caption className="sr-only">Items on {invoice.number}</caption>
                <thead className="bg-surface text-caption text-muted-foreground uppercase">
                  <tr className="border-b border-border">
                    <th scope="col" className="h-10 px-3 text-left font-medium">Item</th>
                    <th scope="col" className="px-3 text-left font-medium">IMEI / serial</th>
                    <th scope="col" className="px-3 text-right font-medium">Qty</th>
                    <th scope="col" className="px-3 text-right font-medium">Unit price</th>
                    <th scope="col" className="px-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2.5">
                        <p className="text-body font-medium">{item.description}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-small text-muted-foreground">
                          {item.condition && <ConditionBadge condition={item.condition} />}
                          {Number(item.discount) > 0 && (
                            <span>
                              Discount <Money value={item.discount} />
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="px-3">{item.identifier ? <IdentifierChip value={item.identifier} /> : "—"}</td>
                      <td className="px-3 text-right tabular-nums">{item.quantity}</td>
                      <td className="px-3 text-right">
                        <Money value={item.unitPrice} />
                      </td>
                      <td className="px-3 text-right">
                        <Money value={item.lineTotal} className="font-medium" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-3 ml-auto max-w-sm text-body">
              <TotalRow label="Subtotal" value={<Money value={invoice.subtotal} />} />
              {Number(invoice.discount) > 0 && <TotalRow label="Discount" value={<Money value={`-${invoice.discount}`} />} />}
              <TotalRow label={`VAT ${Number(invoice.taxRate)}%`} value={<Money value={invoice.taxAmount} />} />
              {Number(invoice.tradeInCredit) > 0 && <TotalRow label="Trade-in" value={<Money value={`-${invoice.tradeInCredit}`} />} />}
              <TotalRow label="Total" value={<Money value={invoice.total} />} strong />
            </dl>
            {invoice.tradeIn && (
              <p className="mt-2 text-small text-muted-foreground">
                Trade-in: {invoice.tradeIn.description} (<Money value={invoice.tradeIn.creditAmount} /> credit)
              </p>
            )}
          </section>

          {invoice.plan && (
            <section aria-labelledby="schedule-heading">
              <SectionHeader
                title="Payment schedule"
                description={`${invoice.plan.numberOfInstallments} instalments · down payment ${formatMoney(invoice.plan.downPayment)}`}
              />
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-small">
                  <caption className="sr-only">Instalments</caption>
                  <thead className="bg-surface text-caption text-muted-foreground uppercase">
                    <tr className="border-b border-border">
                      <th scope="col" className="h-10 w-12 px-3 text-left font-medium">#</th>
                      <th scope="col" className="px-3 text-left font-medium">Due date</th>
                      <th scope="col" className="px-3 text-right font-medium">Amount</th>
                      <th scope="col" className="px-3 text-right font-medium">Paid</th>
                      <th scope="col" className="px-3 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.plan.schedule.map((row) => {
                      const dueSoon = row.status !== "PAID" && row.dueDate >= today && row.dueDate <= addDays(today, DUE_SOON_DAYS);
                      return (
                        <tr key={row.sequence} className={cn("h-11 border-b border-border last:border-b-0", row.status === "OVERDUE" && "shadow-[inset_2px_0_0_var(--danger)]")}>
                          <td className="px-3 tabular-nums">{row.sequence}</td>
                          <td className="px-3 tabular-nums">{cal(row.dueDate)}</td>
                          <td className="px-3 text-right">
                            <Money value={row.amountDue} />
                          </td>
                          <td className="px-3 text-right">
                            <Money value={row.amountPaid} className="text-muted-foreground" />
                          </td>
                          <td className="px-3">
                            <ScheduleStatusBadge status={row.status} dueSoon={dueSoon} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section aria-labelledby="payments-heading">
            <SectionHeader title="Payments" />
            {invoice.payments.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-body text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {invoice.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-body">
                    <span className="w-40 text-muted-foreground tabular-nums">{dateTime.format(new Date(p.paidAt))}</span>
                    <span className="flex-1">
                      {KIND[p.kind]} · {METHOD[p.method]}
                      {p.branchName !== invoice.branch.name ? ` · at ${p.branchName}` : ""}
                    </span>
                    {p.reference && <span className="font-mono text-small text-muted-foreground">{p.reference}</span>}
                    <Money value={p.amount} className="font-medium" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {messages && (
            <MessageTimeline
              invoiceId={invoice.id}
              initial={messages}
              canSend={can(ctx, "message.send")}
              canRemind={invoice.status !== "VOID" && Number(invoice.balance) > 0}
            />
          )}
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-6">
          <section aria-label="Balance" className={cn("rounded-xl border bg-card p-5", overdue ? "border-danger-border" : "border-border")}>
            <dl className="text-body">
              <TotalRow label="Total" value={<Money value={invoice.total} />} />
              <TotalRow label="Paid" value={<Money value={invoice.amountPaid} />} />
              <div className="mt-2 flex items-end justify-between border-t border-dashed border-border pt-3">
                <dt className="font-medium">Balance</dt>
                <dd>
                  <Money value={invoice.balance} className="text-[30px] leading-9 font-bold" tone={overdue ? "danger" : undefined} />
                </dd>
              </div>
            </dl>
            {invoice.plan?.nextDueDate && (
              <p className="mt-2 text-small text-muted-foreground">
                Next instalment due {cal(invoice.plan.nextDueDate)}
                {overdue && <Badge tone="danger" className="ml-2">Overdue</Badge>}
              </p>
            )}
            <p className="mt-3 text-small text-muted-foreground">Recording repayments arrives with the receivables ledger (build step 8).</p>
          </section>

          {warranties.length > 0 && (
            <section aria-labelledby="warranty-heading" className="rounded-xl border border-border bg-card p-5">
              <h2 id="warranty-heading" className="mb-3 flex items-center gap-2 text-h3">
                <ShieldCheck aria-hidden className="size-4" /> Warranty cards
              </h2>
              <ul className="flex flex-col gap-3">
                {warranties.map((item) =>
                  item.warranty ? (
                    <li key={item.id} className="text-body">
                      <p className="font-medium">{item.description}</p>
                      <p className="text-small text-muted-foreground">
                        Until {cal(item.warranty.expiresAt)} · <span className="font-mono">{item.warranty.publicId}</span>
                      </p>
                      <div className="mt-1.5 flex gap-2">
                        <Button asChild size="sm" variant="secondary">
                          <a href={`/api/pdf/warranty/${item.warranty.id}`} target="_blank" rel="noopener">
                            Certificate PDF
                          </a>
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/w/${item.warranty.publicId}`} target="_blank" rel="noopener">
                            <ExternalLink aria-hidden data-icon="inline-start" /> Public check page
                          </Link>
                        </Button>
                      </div>
                    </li>
                  ) : null,
                )}
              </ul>
            </section>
          )}
        </aside>
      </PageBody>
    </>
  );
}
