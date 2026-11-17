import "server-only";

import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

import { CONDITION_LABELS } from "@/components/ui/status-badge";
import { STORE } from "@/config/store";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  formatCalendar,
  formatInstantDate,
  FREQUENCY_WORDS,
  INVOICE_STATUS_WORDS,
  METHOD_WORDS,
  MM,
  money,
  PAYMENT_KIND_WORDS,
  SCHEDULE_WORDS,
} from "@/server/pdf/common";
import { PDF_MONO, PDF_SANS, registerPdfFonts } from "@/server/pdf/fonts";
import type { InvoiceDocument } from "@/server/services/document.service";

/** A4 invoice (DESIGN.md §6.1). Light only; one thin rule and the title carry the accent. */

const s = StyleSheet.create({
  page: { paddingTop: 18 * MM, paddingBottom: 26 * MM, paddingHorizontal: 18 * MM, fontFamily: PDF_SANS, fontSize: 9, color: "#09090B" },
  header: { flexDirection: "row", justifyContent: "space-between" },
  store: { fontSize: 15, fontWeight: 700 },
  title: { fontSize: 20, fontWeight: 700, textAlign: "right", letterSpacing: 1 },
  muted: { color: "#52525B" },
  subtle: { color: "#71717A" },
  mono: { fontFamily: PDF_MONO },
  rule: { borderBottomWidth: 1, borderBottomColor: "#18181B", marginVertical: 10 },
  voidBanner: { borderWidth: 1.5, borderColor: "#B91C1C", color: "#B91C1C", padding: 8, marginBottom: 10 },
  label: { fontSize: 7, color: "#52525B", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  blocks: { flexDirection: "row", gap: 16, marginBottom: 12 },
  block: { flex: 1, borderWidth: 0.75, borderColor: "#D4D4D8", borderRadius: 3, padding: 8 },
  strong: { fontSize: 11, fontWeight: 600, marginBottom: 2 },
  table: { borderWidth: 0.75, borderColor: "#D4D4D8", borderRadius: 3, marginBottom: 10 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E4E4E7", paddingVertical: 5, paddingHorizontal: 6 },
  head: { backgroundColor: "#F4F4F5" },
  th: { fontSize: 7, color: "#52525B", textTransform: "uppercase", letterSpacing: 0.4 },
  right: { textAlign: "right" },
  totals: { alignSelf: "flex-end", width: 230, marginBottom: 12 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { borderTopWidth: 1, borderTopColor: "#18181B", marginTop: 4, paddingTop: 5 },
  section: { fontSize: 10, fontWeight: 600, marginBottom: 5, marginTop: 4 },
  balanceBox: { borderWidth: 0.75, borderColor: "#D4D4D8", borderRadius: 3, padding: 8, flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  footer: { position: "absolute", bottom: 9 * MM, left: 18 * MM, right: 18 * MM, borderTopWidth: 0.5, borderTopColor: "#D4D4D8", paddingTop: 5, fontSize: 7, color: "#71717A" },
});

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={[s.totalRow, bold ? { fontWeight: 700, fontSize: 11 } : {}]}>
      <Text style={bold ? {} : s.muted}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

function InvoiceDocumentPdf({ invoice }: { invoice: InvoiceDocument }) {
  const hasDiscounts = invoice.items.some((i) => Number(i.discount) > 0);
  const warranties = invoice.items.filter((i) => i.warranty);
  return (
    <Document title={`Invoice ${invoice.number}`} author={STORE.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.store}>{STORE.name}</Text>
            <Text style={s.muted}>
              {invoice.branch.name} branch · {invoice.branch.code}
            </Text>
            <Text style={[s.subtle, { fontSize: 7.5 }]}>{STORE.contact.address} · {formatPhoneDisplay(STORE.contact.phone)} · {STORE.contact.email}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.title}>INVOICE</Text>
            <Text style={[s.mono, { fontSize: 11 }]}>{invoice.number}</Text>
            <Text style={s.muted}>
              {formatInstantDate(invoice.createdAt)} · {INVOICE_STATUS_WORDS[invoice.displayStatus]}
            </Text>
          </View>
        </View>
        <View style={s.rule} />
        {invoice.voided && (
          <View style={s.voidBanner}>
            <Text style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>VOID — NOT A VALID INVOICE</Text>
            <Text>
              Voided {formatInstantDate(invoice.voided.at)} by {invoice.voided.byName}: {invoice.voided.reason}
            </Text>
          </View>
        )}

        <View style={s.blocks}>
          <View style={s.block}>
            <Text style={s.label}>Issued by</Text>
            <Text style={s.strong}>
              {STORE.name} — {invoice.branch.name}
            </Text>
            <Text>{invoice.branch.address}</Text>
            <Text style={s.muted}>
              {formatPhoneDisplay(invoice.branch.phone)}
              {invoice.branch.email ? ` · ${invoice.branch.email}` : ""}
            </Text>
            <Text style={[s.subtle, { marginTop: 3 }]}>Served by {invoice.cashierName}</Text>
          </View>
          <View style={s.block}>
            <Text style={s.label}>Billed to</Text>
            <Text style={s.strong}>{invoice.customer.name}</Text>
            <Text>{formatPhoneDisplay(invoice.customer.phoneE164)}</Text>
            {invoice.customer.email && <Text style={s.muted}>{invoice.customer.email}</Text>}
            <Text style={[s.subtle, { marginTop: 3 }]}>{invoice.paymentType === "INSTALLMENT" ? "Installment sale" : "Paid in full at sale"}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={[s.row, s.head]} fixed>
            <Text style={[s.th, { flex: 1 }]}>Description</Text>
            <Text style={[s.th, { width: 110 }]}>IMEI / serial</Text>
            <Text style={[s.th, s.right, { width: 28 }]}>Qty</Text>
            <Text style={[s.th, s.right, { width: 78 }]}>Unit price</Text>
            {hasDiscounts && <Text style={[s.th, s.right, { width: 62 }]}>Discount</Text>}
            <Text style={[s.th, s.right, { width: 82 }]}>Amount</Text>
          </View>
          {invoice.items.map((item) => (
            <View key={item.id} style={s.row} wrap={false}>
              <View style={{ flex: 1, paddingRight: 6 }}>
                <Text>{item.description}</Text>
                <Text style={[s.subtle, { fontSize: 7.5 }]}>
                  {[item.condition ? CONDITION_LABELS[item.condition] : null, item.warrantyMonths > 0 ? `${item.warrantyMonths}-month warranty` : null]
                    .filter(Boolean)
                    .join(" · ") || " "}
                </Text>
              </View>
              <Text style={[s.mono, { width: 110, fontSize: 8 }]}>{item.identifier ?? "—"}</Text>
              <Text style={[s.right, { width: 28 }]}>{item.quantity}</Text>
              <Text style={[s.right, { width: 78 }]}>{money(item.unitPrice)}</Text>
              {hasDiscounts && <Text style={[s.right, { width: 62 }]}>{Number(item.discount) > 0 ? `−${money(item.discount)}` : "—"}</Text>}
              <Text style={[s.right, { width: 82 }]}>{money(item.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals} wrap={false}>
          <TotalRow label="Subtotal" value={money(invoice.subtotal)} />
          {Number(invoice.discount) > 0 && <TotalRow label="Discount" value={`−${money(invoice.discount)}`} />}
          <TotalRow label={`VAT ${Number(invoice.taxRate)}%`} value={money(invoice.taxAmount)} />
          {Number(invoice.tradeInCredit) > 0 && <TotalRow label="Trade-in credit" value={`−${money(invoice.tradeInCredit)}`} />}
          <View style={s.grand}>
            <TotalRow label="Total" value={money(invoice.total)} bold />
          </View>
          {Number(invoice.returnedAmount) > 0 && <TotalRow label="Returned" value={`−${money(invoice.returnedAmount)}`} />}
          {Number(invoice.adjustedAmount) > 0 && <TotalRow label="Waived" value={`−${money(invoice.adjustedAmount)}`} />}
          <TotalRow label="Amount paid" value={money(invoice.amountPaid)} />
          <TotalRow label="Balance due" value={money(invoice.balance)} bold />
        </View>

        {invoice.tradeIn && (
          <Text style={[s.muted, { marginBottom: 10 }]}>
            Trade-in received: {invoice.tradeIn.description} ({money(invoice.tradeIn.creditAmount)} credit)
          </Text>
        )}

        {invoice.payments.length > 0 && (
          <View wrap={false}>
            <Text style={s.section}>Payments</Text>
            <View style={s.table}>
              <View style={[s.row, s.head]}>
                <Text style={[s.th, { width: 80 }]}>Date</Text>
                <Text style={[s.th, { flex: 1 }]}>Type</Text>
                <Text style={[s.th, { width: 80 }]}>Method</Text>
                <Text style={[s.th, { width: 100 }]}>Reference</Text>
                <Text style={[s.th, s.right, { width: 82 }]}>Amount</Text>
              </View>
              {invoice.payments.map((p) => (
                <View key={p.id} style={s.row}>
                  <Text style={{ width: 80 }}>{formatInstantDate(p.paidAt)}</Text>
                  <Text style={{ flex: 1 }}>
                    {p.isReversal ? "Reversal" : PAYMENT_KIND_WORDS[p.kind]}
                    {p.branchName !== invoice.branch.name ? ` (${p.branchName})` : ""}
                  </Text>
                  <Text style={{ width: 80 }}>{METHOD_WORDS[p.method]}</Text>
                  <Text style={[s.mono, { width: 100, fontSize: 8 }]}>{p.reference ?? "—"}</Text>
                  <Text style={[s.right, { width: 82 }]}>{money(p.amount)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {invoice.plan && (
          <View>
            <Text style={s.section}>
              Payment schedule — {invoice.plan.numberOfInstallments} instalments, {FREQUENCY_WORDS[invoice.plan.frequency]}
            </Text>
            <View style={s.balanceBox} wrap={false}>
              <View>
                <Text style={s.label}>Down payment</Text>
                <Text>{money(invoice.plan.downPayment)}</Text>
              </View>
              <View>
                <Text style={s.label}>Financed</Text>
                <Text>{money(invoice.plan.financedAmount)}</Text>
              </View>
              <View>
                <Text style={s.label}>Balance remaining</Text>
                <Text style={{ fontWeight: 700 }}>{money(invoice.balance)}</Text>
              </View>
              <View>
                <Text style={s.label}>Next due</Text>
                <Text>{invoice.plan.nextDueDate ? formatCalendar(invoice.plan.nextDueDate) : "—"}</Text>
              </View>
            </View>
            <View style={s.table}>
              <View style={[s.row, s.head]} fixed>
                <Text style={[s.th, { width: 24 }]}>#</Text>
                <Text style={[s.th, { flex: 1 }]}>Due date</Text>
                <Text style={[s.th, s.right, { width: 90 }]}>Amount</Text>
                <Text style={[s.th, s.right, { width: 90 }]}>Paid</Text>
                <Text style={[s.th, s.right, { width: 70 }]}>Status</Text>
              </View>
              {invoice.plan.schedule.map((row) => (
                <View key={row.sequence} style={s.row} wrap={false}>
                  <Text style={{ width: 24 }}>{row.sequence}</Text>
                  <Text style={{ flex: 1 }}>{formatCalendar(row.dueDate)}</Text>
                  <Text style={[s.right, { width: 90 }]}>{money(row.amountDue)}</Text>
                  <Text style={[s.right, { width: 90 }]}>{money(row.amountPaid)}</Text>
                  <Text style={[s.right, { width: 70, fontWeight: row.status === "OVERDUE" ? 700 : 400 }]}>{SCHEDULE_WORDS[row.status]}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {warranties.length > 0 && (
          <View wrap={false}>
            <Text style={s.section}>Warranty</Text>
            {warranties.map((item) => (
              <Text key={item.id} style={{ marginBottom: 2 }}>
                {item.description} <Text style={[s.mono, { fontSize: 8 }]}>{item.identifier}</Text> — covered until{" "}
                {item.warranty ? formatCalendar(item.warranty.expiresAt) : "—"}. Card ID{" "}
                <Text style={[s.mono, { fontSize: 8 }]}>{item.warranty?.publicId}</Text>
              </Text>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>{STORE.returnPolicy}</Text>
          <Text>{invoice.paymentInstructions}</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
            <Text>
              {STORE.name} · {invoice.number}
            </Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(invoice: InvoiceDocument): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(<InvoiceDocumentPdf invoice={invoice} />);
}
