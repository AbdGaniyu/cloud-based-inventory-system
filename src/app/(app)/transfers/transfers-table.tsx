"use client";

import { ArrowRight, Truck } from "lucide-react";
import { useRouter } from "next/navigation";

import { DataTable, columnHelper } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { IdentifierChip } from "@/components/identifier-chip";
import { Badge, TransferStatusBadge } from "@/components/ui/status-badge";
import type { TransferListRow } from "@/server/services/transfer.service";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const date = (value: string | null) => (value ? dateFormat.format(new Date(value)) : "—");

const col = columnHelper<TransferListRow>();

export function TransfersTable({ rows, emptyAction }: { rows: TransferListRow[]; emptyAction?: React.ReactNode }) {
  const router = useRouter();
  const columns = col.columns([
    col.accessor("number", {
      header: "Transfer",
      enableHiding: false,
      cell: ({ getValue }) => <IdentifierChip value={getValue()} copyable={false} />,
    }),
    col.display({
      id: "route",
      header: "Route",
      meta: { label: "Route" },
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span title={row.original.from.name} className="font-mono">
            {row.original.from.code}
          </span>
          <ArrowRight aria-label="to" className="size-3.5 text-muted-foreground" />
          <span title={row.original.to.name} className="font-mono">
            {row.original.to.code}
          </span>
        </span>
      ),
    }),
    col.display({
      id: "items",
      header: "Items",
      meta: { label: "Items" },
      cell: ({ row }) => {
        const parts = [
          row.original.devices ? `${row.original.devices} device${row.original.devices === 1 ? "" : "s"}` : null,
          row.original.accessoryQuantity ? `${row.original.accessoryQuantity} accessories` : null,
        ].filter(Boolean);
        return <span className="tabular-nums">{parts.join(" · ")}</span>;
      },
    }),
    col.accessor("status", {
      header: "Status",
      meta: { label: "Status" },
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <TransferStatusBadge status={row.original.status} />
          {row.original.hasDiscrepancy && <Badge tone="warning">Short</Badge>}
        </span>
      ),
    }),
    col.accessor("createdAt", { header: "Created", meta: { label: "Created", align: "right" }, cell: ({ getValue }) => date(getValue()) }),
    col.accessor("shippedAt", { header: "Shipped", meta: { label: "Shipped", align: "right" }, cell: ({ getValue }) => date(getValue()) }),
    col.accessor("receivedAt", { header: "Received", meta: { label: "Received", align: "right" }, cell: ({ getValue }) => date(getValue()) }),
  ]);

  return (
    <DataTable
      caption="Stock transfers"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      onRowOpen={(row) => router.push(`/transfers/${row.id}`)}
      rowLabel={(row) => `${row.number}, ${row.from.code} to ${row.to.code} — open`}
      empty={<EmptyState icon={Truck} title="No transfers here" description="Move stock between branches with a transfer." action={emptyAction} />}
    />
  );
}
