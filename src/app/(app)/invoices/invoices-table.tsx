"use client";

import { ReceiptText } from "lucide-react";
import { useRouter } from "next/navigation";

import { DataTable, columnHelper } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { IdentifierChip } from "@/components/identifier-chip";
import { Money } from "@/components/money";
import { SearchInput } from "@/components/search-input";
import { InvoiceStatusBadge } from "@/components/ui/status-badge";
import { formatPhoneDisplay } from "@/lib/phone";
import type { InvoiceListRow } from "@/server/services/invoice.service";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const col = columnHelper<InvoiceListRow>();

export function InvoicesTable({ rows, showBranch }: { rows: InvoiceListRow[]; showBranch: boolean }) {
  const router = useRouter();
  const columns = col.columns([
    col.accessor("number", {
      header: "Invoice",
      enableHiding: false,
      cell: ({ row }) => (
        <IdentifierChip value={row.original.number} copyable={false} className={row.original.displayStatus === "VOID" ? "line-through" : undefined} />
      ),
    }),
    col.accessor("customerName", {
      header: "Customer",
      meta: { label: "Customer" },
      cell: ({ row }) => (
        <div>
          <p className="text-body font-medium">{row.original.customerName}</p>
          <p className="text-small text-muted-foreground tabular-nums">{formatPhoneDisplay(row.original.customerPhone)}</p>
        </div>
      ),
    }),
    ...(showBranch
      ? [col.accessor("branchCode", { header: "Branch", meta: { label: "Branch" }, cell: ({ getValue }) => <span className="font-mono">{getValue()}</span> })]
      : []),
    col.accessor("createdAt", { header: "Date", meta: { label: "Date" }, cell: ({ getValue }) => dateFormat.format(new Date(getValue())) }),
    col.accessor("paymentType", { header: "Type", meta: { label: "Type" }, cell: ({ getValue }) => (getValue() === "INSTALLMENT" ? "Installment" : "Full") }),
    col.accessor("total", { header: "Total", meta: { label: "Total", align: "right" }, cell: ({ getValue }) => <Money value={getValue()} /> }),
    col.accessor("amountPaid", { header: "Paid", meta: { label: "Paid", align: "right" }, cell: ({ getValue }) => <Money value={getValue()} className="text-muted-foreground" /> }),
    col.accessor("balance", {
      header: "Balance",
      meta: { label: "Balance", align: "right" },
      cell: ({ row }) => <Money value={row.original.balance} className="font-medium" tone={row.original.displayStatus === "OVERDUE" ? "danger" : undefined} />,
    }),
    col.accessor("displayStatus", { header: "Status", meta: { label: "Status" }, cell: ({ getValue }) => <InvoiceStatusBadge status={getValue()} /> }),
  ]);

  return (
    <DataTable
      caption="Invoices"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      onRowOpen={(row) => router.push(`/invoices/${row.id}`)}
      rowLabel={(row) => `${row.number}, ${row.customerName} — open`}
      rowClassName={(row) => (row.displayStatus === "OVERDUE" ? "shadow-[inset_2px_0_0_var(--danger)]" : undefined)}
      toolbar={<SearchInput placeholder="Invoice number, customer or phone" label="Search invoices" />}
      empty={<EmptyState icon={ReceiptText} title="No invoices match" description="Sales appear here as soon as they are completed at the POS." />}
    />
  );
}
