import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";

import { ReceiptPrintControls } from "@/app/(print)/print/receipt/[id]/auto-print";
import { CONDITION_LABELS } from "@/components/ui/status-badge";
import { STORE } from "@/config/store";
import { formatMoney } from "@/lib/money";
import { formatPhoneDisplay } from "@/lib/phone";
import { requirePageAccess } from "@/server/auth/session";
import { signedDocumentUrl } from "@/server/documents/signed-url";
import { NotFoundError } from "@/server/errors";
import { getInvoiceDocument } from "@/server/services/document.service";

export const metadata: Metadata = { title: "Receipt" };

const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: STORE.timezone });
const calendar = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const METHOD = { CASH: "Cash", BANK_TRANSFER: "Transfer", POS_CARD: "POS card" } as const;

export default function ReceiptPage({ params, searchParams }: PageProps<"/print/receipt/[id]">) {
  return (
    <Suspense fallback={<p className="p-8 text-body">Preparing receipt…</p>}>
      <Receipt params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={bold ? "flex justify-between font-bold" : "flex justify-between"}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

const Divider = () => <hr className="my-1.5 border-0 border-t border-dashed border-black" />;

/** 80mm thermal receipt (DESIGN.md §6.2): 72mm printable, black on white, QR to the hosted invoice. */
async function Receipt({ params, searchParams }: { params: PageProps<"/print/receipt/[id]">["params"]; searchParams: PageProps<"/print/receipt/[id]">["searchParams"] }) {
  const ctx = await requirePageAccess("invoice.view");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const invoice = await getInvoiceDocument(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const qr = await QRCode.toString(signedDocumentUrl("invoice", invoice.id), { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const balanceDue = Number(invoice.balance) > 0;

  return (
    <div className="min-h-screen bg-zinc-100 py-6 text-black print:bg-white print:py-0">
      <style>{"@page { size: 80mm auto; margin: 4mm; } @media print { html, body { background: #fff; } }"}</style>
      <div className="mx-auto mb-4 flex w-[72mm] justify-between gap-2 print:hidden">
        <Link href={`/invoices/${invoice.id}`} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-small">
          Open invoice
        </Link>
        <ReceiptPrintControls autoPrint={query.autoprint === "1"} />
      </div>
      <article className="mx-auto w-[72mm] bg-white p-[2mm] font-sans text-[11.5px] leading-[1.35] shadow print:shadow-none" aria-label={`Receipt ${invoice.number}`}>
        <header className="text-center">
          <p className="text-[15px] font-bold">{STORE.name}</p>
          <p>{invoice.branch.name} branch</p>
          <p>{invoice.branch.address}</p>
          <p>{formatPhoneDisplay(invoice.branch.phone)}</p>
        </header>
        <Divider />
        <Row label="Receipt" value={invoice.number} />
        <Row label="Date" value={dateTime.format(new Date(invoice.createdAt))} />
        <Row label="Customer" value={invoice.customer.name} />
        <Row label="Served by" value={invoice.cashierName} />
        <Divider />
        {invoice.items.map((item) => (
          <div key={item.id} className="mb-1">
            <p className="font-semibold">{item.description}</p>
            {item.identifier && <p className="font-mono text-[11px]">IMEI/SN {item.identifier}</p>}
            {item.condition && <p className="text-[10.5px]">{CONDITION_LABELS[item.condition]}{item.warranty ? ` · warranty to ${calendar.format(new Date(`${item.warranty.expiresAt}T00:00:00Z`))}` : ""}</p>}
            <Row label={`${item.quantity} × ${formatMoney(item.unitPrice)}${Number(item.discount) > 0 ? ` − ${formatMoney(item.discount)}` : ""}`} value={formatMoney(item.lineTotal)} />
          </div>
        ))}
        <Divider />
        <Row label="Subtotal" value={formatMoney(invoice.subtotal)} />
        {Number(invoice.discount) > 0 && <Row label="Discount" value={`−${formatMoney(invoice.discount)}`} />}
        <Row label={`VAT ${Number(invoice.taxRate)}%`} value={formatMoney(invoice.taxAmount)} />
        {Number(invoice.tradeInCredit) > 0 && <Row label="Trade-in" value={`−${formatMoney(invoice.tradeInCredit)}`} />}
        <div className="mt-1 text-[13px]">
          <Row label="TOTAL" value={formatMoney(invoice.total)} bold />
        </div>
        <Divider />
        {invoice.payments.map((p) => (
          <Row key={p.id} label={`${METHOD[p.method]}${p.reference ? ` ${p.reference}` : ""}`} value={formatMoney(p.amount)} />
        ))}
        <Row label="Paid" value={formatMoney(invoice.amountPaid)} bold />
        {balanceDue && (
          <>
            <Row label="BALANCE DUE" value={formatMoney(invoice.balance)} bold />
            {invoice.plan?.nextDueDate && <Row label="Next instalment" value={calendar.format(new Date(`${invoice.plan.nextDueDate}T00:00:00Z`))} />}
          </>
        )}
        <Divider />
        <div className="mx-auto mt-2 size-[30mm] [&_svg]:h-full [&_svg]:w-full" aria-label="QR code linking to your invoice" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="mt-1 text-center text-[10px]">Scan for your full invoice</p>
        <Divider />
        <p className="text-center text-[10px]">{STORE.returnPolicy}</p>
        <p className="mt-1 text-center text-[11px] font-semibold">Thank you for shopping with us</p>
      </article>
    </div>
  );
}
