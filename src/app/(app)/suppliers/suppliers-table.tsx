"use client";

import { Truck } from "lucide-react";
import { useRouter } from "next/navigation";

import { DataTable, columnHelper } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { SearchInput } from "@/components/search-input";
import { Badge } from "@/components/ui/status-badge";
import { formatPhoneDisplay } from "@/lib/phone";
import type { SupplierListRow } from "@/server/services/payables.service";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const col = columnHelper<SupplierListRow>();

export function SuppliersTable({ rows }: { rows: SupplierListRow[] }) {
  const router = useRouter();
  const columns = col.columns([
    col.accessor("name", {
      header: "Supplier",
      enableHiding: false,
      cell: ({ row }) => (
        <div>
          <p className="text-body font-medium">{row.original.name}</p>
          <p className="text-small text-muted-foreground">
            {[row.original.contactPerson, row.original.phone ? formatPhoneDisplay(row.original.phone) : null].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      ),
    }),
    col.accessor("openOrders", { header: "Open orders", meta: { label: "Open orders", align: "right" }, cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> }),
    col.accessor("balance", {
      header: "Balance owed",
      meta: { label: "Balance owed", align: "right" },
      cell: ({ row }) => <Money value={row.original.balance} className="font-medium" tone={row.original.overdue ? "danger" : undefined} />,
    }),
    col.accessor("overdue", { header: "Status", meta: { label: "Status" }, cell: ({ row }) => (row.original.overdue ? <Badge tone="danger">Overdue</Badge> : row.original.balance === "0.00" ? <Badge tone="success">Settled</Badge> : <Badge tone="neutral">On terms</Badge>) }),
    col.accessor("lastDeliveryAt", { header: "Last delivery", meta: { label: "Last delivery" }, cell: ({ getValue }) => { const v = getValue(); return v ? dateFormat.format(new Date(v)) : "—"; } }),
  ]);
  return (
    <DataTable
      caption="Suppliers"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      onRowOpen={(row) => router.push(`/suppliers/${row.id}`)}
      rowLabel={(row) => `${row.name} — open`}
      rowClassName={(row) => (row.overdue ? "shadow-[inset_2px_0_0_var(--danger)]" : undefined)}
      toolbar={<SearchInput placeholder="Supplier name" label="Search suppliers" />}
      empty={<EmptyState icon={Truck} title="No suppliers yet" description="Suppliers are added during stock intake." />}
    />
  );
}
