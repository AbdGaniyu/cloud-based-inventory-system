"use client";

import { PackageMinus, PackageSearch } from "lucide-react";
import Link from "next/link";

import { DataTable, columnHelper } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { IdentifierChip } from "@/components/identifier-chip";
import { Money } from "@/components/money";
import { SearchInput } from "@/components/search-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";
import type { AccessoryRow, BranchColumn } from "@/server/services/inventory.service";

function QuantityCell({ stock }: { stock: AccessoryRow["stock"][string] | undefined }) {
  if (!stock) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      title={stock.inTransit ? `${stock.inTransit} in transit out of this branch` : undefined}
      className={cn(
        "inline-flex min-w-10 justify-end rounded-md px-2 py-0.5 tabular-nums",
        stock.low && "border border-warning-border bg-warning-bg font-medium text-warning",
      )}
    >
      {stock.quantity}
      {stock.low && <span className="sr-only"> (low stock)</span>}
    </span>
  );
}

/** Quantities elsewhere, visible to every role (CLAUDE.md §7.1). */
function OtherBranches({ row, branches, scopeBranchId }: { row: AccessoryRow; branches: BranchColumn[]; scopeBranchId: string }) {
  const others = branches.filter((b) => b.id !== scopeBranchId);
  const total = others.reduce((n, b) => n + (row.stock[b.id]?.quantity ?? 0), 0);
  return (
    <Popover>
      <PopoverTrigger
        onClick={(event) => event.stopPropagation()}
        className="rounded-md px-2 py-1 text-small text-muted-foreground underline-offset-4 hover:bg-secondary hover:underline"
      >
        {total} elsewhere
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2 shadow-popover">
        <p className="px-2 pb-1 text-caption uppercase text-subtle-foreground">Other branches</p>
        <ul>
          {others.map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-body">
              <span>
                {b.name} <span className="font-mono text-small text-muted-foreground">{b.code}</span>
              </span>
              <span className="tabular-nums">{row.stock[b.id]?.quantity ?? 0}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const col = columnHelper<AccessoryRow>();

export function AccessoriesTable({
  rows,
  branches,
  scopeBranchId,
  lowOnly,
}: {
  rows: AccessoryRow[];
  branches: BranchColumn[];
  scopeBranchId: string | null;
  lowOnly: boolean;
}) {
  const { hrefWith } = useUrlParams();
  const scopeBranch = branches.find((b) => b.id === scopeBranchId);

  const quantityColumns = scopeBranch
    ? [
        col.display({
          id: "scopeQty",
          header: scopeBranch.name,
          meta: { label: scopeBranch.name, align: "right" },
          cell: ({ row }) => <QuantityCell stock={row.original.stock[scopeBranch.id]} />,
        }),
        col.display({
          id: "elsewhere",
          header: "Other branches",
          meta: { label: "Other branches", align: "right" },
          cell: ({ row }) => <OtherBranches row={row.original} branches={branches} scopeBranchId={scopeBranch.id} />,
        }),
      ]
    : [
        ...branches.map((b) =>
          col.display({
            id: `branch-${b.id}`,
            header: () => <span title={b.name}>{b.code}</span>,
            meta: { label: b.name, align: "right" },
            cell: ({ row }) => <QuantityCell stock={row.original.stock[b.id]} />,
          }),
        ),
        col.accessor("total", {
          header: "Total",
          meta: { label: "Total", align: "right" },
          cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
        }),
      ];

  const columns = col.columns([
    col.accessor("name", {
      header: "Accessory",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-foreground">{row.original.name}</p>
          <p className="truncate text-small text-muted-foreground">{row.original.brand}</p>
        </div>
      ),
    }),
    col.accessor("sku", { header: "SKU", meta: { label: "SKU" }, cell: ({ getValue }) => <IdentifierChip value={getValue()} /> }),
    ...quantityColumns,
    col.accessor("reorderLevel", {
      header: "Reorder at",
      meta: { label: "Reorder level", align: "right" },
      cell: ({ getValue }) => (getValue() > 0 ? getValue() : <span className="text-muted-foreground">Off</span>),
    }),
    col.accessor("sellingPrice", {
      header: "Price",
      meta: { label: "Selling price", align: "right" },
      cell: ({ getValue }) => <Money value={getValue()} />,
    }),
  ]);

  return (
    <DataTable
      caption="Accessory quantities per branch"
      columns={columns}
      data={rows}
      getRowId={(row) => row.productId}
      toolbar={
        <>
          <SearchInput placeholder="Accessory, SKU or barcode" label="Search accessories" />
          <Link
            href={hrefWith({ low: lowOnly ? null : "1" })}
            scroll={false}
            aria-pressed={lowOnly}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md border px-3 text-body transition-colors duration-150",
              lowOnly ? "border-warning-border bg-warning-bg text-warning" : "border-border hover:bg-secondary",
            )}
          >
            <PackageMinus aria-hidden className="size-4" /> Low stock only
          </Link>
        </>
      }
      empty={
        <EmptyState
          icon={PackageSearch}
          title={lowOnly ? "Nothing is low on stock" : "No accessories match"}
          description={lowOnly ? "Every accessory is above its reorder level." : "Try another search."}
        />
      }
    />
  );
}
