"use client";

import { Banknote, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DataTable, columnHelper } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { IdentifierChip } from "@/components/identifier-chip";
import { PayoutSheet, type PayoutTarget } from "@/components/ledger/payout-sheet";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { PurchaseOrderStatusBadge } from "@/components/ui/status-badge";
import type { PayableRow } from "@/server/services/payables.service";

const TERMS = { PAID_IN_FULL: "Paid in full", PARTIAL_DEPOSIT: "Deposit", NET_7: "Net 7", NET_15: "Net 15", NET_30: "Net 30" } as const;
const calendar = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const col = columnHelper<PayableRow>();

function DueCell({ row }: { row: PayableRow }) {
  if (!row.dueDate) return <span className="text-muted-foreground">—</span>;
  const d = row.dueInDays;
  return (
    <div>
      <p className="tabular-nums">{calendar.format(new Date(`${row.dueDate}T00:00:00Z`))}</p>
      {d !== null && (
        <p className={d > 0 ? "text-small text-danger" : "text-small text-muted-foreground"}>
          {d > 0 ? `${d} day${d === 1 ? "" : "s"} overdue` : d === 0 ? "Due today" : `In ${-d} day${d === -1 ? "" : "s"}`}
        </p>
      )}
    </div>
  );
}

/** Purchase orders with what is still owed (DESIGN.md §5.5); each open row has Record payout. */
export function PayablesTable({ rows, showSupplier = true }: { rows: PayableRow[]; showSupplier?: boolean }) {
  const [target, setTarget] = useState<PayoutTarget | null>(null);
  const columns = col.columns([
    col.accessor("number", {
      header: "Purchase order",
      enableHiding: false,
      cell: ({ row }) => (
        <div>
          <IdentifierChip value={row.original.number} copyable={false} />
          <p className="mt-0.5 text-small text-muted-foreground">
            {row.original.branchCode} · {TERMS[row.original.paymentTerms]}
          </p>
        </div>
      ),
    }),
    ...(showSupplier
      ? [
          col.accessor("supplierName", {
            header: "Supplier",
            meta: { label: "Supplier" },
            cell: ({ row }) => (
              <Link href={`/suppliers/${row.original.supplierId}`} className="font-medium hover:underline">
                {row.original.supplierName}
              </Link>
            ),
          }),
        ]
      : []),
    col.accessor("totalCost", { header: "Total", meta: { label: "Total", align: "right" }, cell: ({ getValue }) => <Money value={getValue()} /> }),
    col.accessor("amountPaid", { header: "Paid", meta: { label: "Paid", align: "right" }, cell: ({ getValue }) => <Money value={getValue()} className="text-muted-foreground" /> }),
    col.accessor("balance", {
      header: "Balance",
      meta: { label: "Balance", align: "right" },
      cell: ({ row }) => <Money value={row.original.balance} className="font-medium" tone={row.original.status === "OVERDUE" ? "danger" : undefined} />,
    }),
    col.accessor("dueDate", { header: "Due", meta: { label: "Due" }, cell: ({ row }) => <DueCell row={row.original} /> }),
    col.accessor("status", { header: "Status", meta: { label: "Status" }, cell: ({ getValue }) => <PurchaseOrderStatusBadge status={getValue()} /> }),
    col.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      cell: ({ row }) =>
        row.original.balance !== "0.00" ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setTarget(row.original)}>
            <Banknote aria-hidden data-icon="inline-start" /> Record payout
          </Button>
        ) : null,
    }),
  ]);
  return (
    <>
      <DataTable
        caption="Purchase orders"
        columns={columns}
        data={rows}
        getRowId={(row) => row.purchaseOrderId}
        rowClassName={(row) => (row.status === "OVERDUE" ? "shadow-[inset_2px_0_0_var(--danger)]" : undefined)}
        empty={<EmptyState icon={Receipt} title="Nothing owed here" description="Purchase orders bought on credit appear here until they are paid." />}
      />
      <PayoutSheet target={target} onClose={() => setTarget(null)} />
    </>
  );
}
