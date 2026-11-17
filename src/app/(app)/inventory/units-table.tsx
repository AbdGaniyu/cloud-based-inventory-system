"use client";

import { Clock, PackageSearch } from "lucide-react";
import Link from "next/link";

import { DataTable, columnHelper } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { IdentifierChip } from "@/components/identifier-chip";
import { Money } from "@/components/money";
import { ParamSelect } from "@/components/param-select";
import { SearchInput } from "@/components/search-input";
import { CONDITION_LABELS, ConditionBadge, UnitStatusBadge } from "@/components/ui/status-badge";
import { UnitCondition, UnitStatus } from "@/generated/prisma/enums";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";
import type { UnitRow } from "@/server/services/inventory.service";

const STATUS_LABELS: Record<UnitStatus, string> = {
  IN_STOCK: "In stock",
  IN_TRANSIT: "In transit",
  SOLD: "Sold",
  RETURNED: "Returned",
  TRADED_IN: "Traded in",
  DEFECTIVE: "Defective",
  WRITTEN_OFF: "Written off",
};

/** Days-in-stock colour: Warning from 15 days before the aging threshold, Danger past it (DESIGN.md §5.7). */
function DaysInStock({ days, agingDays, status }: { days: number; agingDays: number; status: UnitStatus }) {
  const live = status === "IN_STOCK" || status === "IN_TRANSIT";
  const tone = !live ? "" : days > agingDays ? "text-danger font-medium" : days >= agingDays - 15 ? "text-warning font-medium" : "";
  return <span className={cn("tabular-nums", tone)}>{days}d</span>;
}

function specLine(row: UnitRow): string {
  return [row.storage, row.ram && `${row.ram} RAM`, row.color, row.batteryHealth !== null && `Battery ${row.batteryHealth}%`]
    .filter(Boolean)
    .join(" · ");
}

const col = columnHelper<UnitRow>();

export function UnitsTable({
  rows,
  agingDays,
  showCost,
  showBranch,
  products,
  agingActive,
}: {
  rows: UnitRow[];
  agingDays: number;
  showCost: boolean;
  showBranch: boolean;
  products: { id: string; name: string }[];
  agingActive: boolean;
}) {
  const { setParams, hrefWith } = useUrlParams();

  const columns = col.columns([
    col.accessor("productName", {
      header: "Device",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-foreground">{row.original.productName}</p>
          <p className="truncate text-small text-muted-foreground">{specLine(row.original) || row.original.category}</p>
        </div>
      ),
    }),
    col.display({
      id: "identifier",
      header: "IMEI / serial",
      meta: { label: "IMEI / serial" },
      cell: ({ row }) => <IdentifierChip value={row.original.imei ?? row.original.serialNumber ?? "—"} />,
    }),
    col.accessor("condition", {
      header: "Condition",
      meta: { label: "Condition" },
      cell: ({ getValue }) => <ConditionBadge condition={getValue()} />,
    }),
    ...(showBranch
      ? [
          col.accessor("branchCode", {
            header: "Branch",
            meta: { label: "Branch" },
            cell: ({ row }) => <span title={row.original.branchName} className="font-mono text-small">{row.original.branchCode}</span>,
          }),
        ]
      : []),
    col.accessor("daysInStock", {
      header: "In stock",
      meta: { label: "Days in stock", align: "right" },
      cell: ({ row }) => <DaysInStock days={row.original.daysInStock} agingDays={agingDays} status={row.original.status} />,
    }),
    col.accessor("sellingPrice", {
      header: "Price",
      meta: { label: "Selling price", align: "right" },
      cell: ({ getValue }) => <Money value={getValue()} className="font-medium" />,
    }),
    ...(showCost
      ? [
          col.display({
            id: "costPrice",
            header: "Cost",
            meta: { label: "Cost", align: "right" },
            cell: ({ row }) => (row.original.costPrice ? <Money value={row.original.costPrice} className="text-muted-foreground" /> : null),
          }),
        ]
      : []),
    col.accessor("status", {
      header: "Status",
      meta: { label: "Status" },
      cell: ({ getValue }) => <UnitStatusBadge status={getValue()} />,
    }),
  ]);

  return (
    <DataTable
      caption="Serialized devices"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      onRowOpen={(row) => setParams({ unit: row.id }, { keepPage: true })}
      rowLabel={(row) => `${row.productName} ${row.imei ?? row.serialNumber ?? ""} — open details`}
      toolbar={
        <>
          <SearchInput placeholder="IMEI, serial or device" label="Search devices" />
          <ParamSelect
            param="status"
            label="Status"
            anyLabel="All statuses"
            defaultValue="IN_STOCK"
            options={[
              { value: "ALL", label: "All statuses" },
              ...Object.values(UnitStatus).map((s) => ({ value: s, label: STATUS_LABELS[s] })),
            ]}
          />
          <ParamSelect
            param="condition"
            label="Condition"
            anyLabel="Any condition"
            options={Object.values(UnitCondition).map((c) => ({ value: c, label: CONDITION_LABELS[c] }))}
          />
          <ParamSelect param="product" label="Product" anyLabel="All devices" options={products.map((p) => ({ value: p.id, label: p.name }))} />
          <Link
            href={hrefWith({ aging: agingActive ? null : "1", status: null })}
            scroll={false}
            aria-pressed={agingActive}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md border px-3 text-body transition-colors duration-150",
              agingActive ? "border-warning-border bg-warning-bg text-warning" : "border-border hover:bg-secondary",
            )}
          >
            <Clock aria-hidden className="size-4" /> {agingDays}+ days
          </Link>
        </>
      }
      empty={
        <EmptyState
          icon={PackageSearch}
          title="No devices match"
          description="Try another search or clear the filters. Received stock appears here as soon as an intake is saved."
        />
      }
    />
  );
}
