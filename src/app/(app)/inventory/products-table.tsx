"use client";

import { PackageSearch, Pencil } from "lucide-react";
import Link from "next/link";

import { DataTable, columnHelper } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { IdentifierChip } from "@/components/identifier-chip";
import { Money } from "@/components/money";
import { ParamSelect } from "@/components/param-select";
import { SearchInput } from "@/components/search-input";
import { Badge } from "@/components/ui/status-badge";
import { useUrlParams } from "@/hooks/use-url-params";
import type { ProductRow } from "@/server/services/inventory.service";

const col = columnHelper<ProductRow>();

export function ProductsTable({
  rows,
  categories,
  canEdit,
  showCost,
}: {
  rows: ProductRow[];
  categories: string[];
  canEdit: boolean;
  showCost: boolean;
}) {
  const { hrefWith } = useUrlParams();

  const columns = col.columns([
    col.accessor("name", {
      header: "Product",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-body font-medium text-foreground">
            {row.original.name}
            {!row.original.isActive && (
              <Badge tone="neutral" dot={false}>
                Inactive
              </Badge>
            )}
          </p>
          <p className="truncate text-small text-muted-foreground">
            {row.original.brand} · {row.original.category}
          </p>
        </div>
      ),
    }),
    col.accessor("trackingType", {
      header: "Tracked by",
      meta: { label: "Tracked by" },
      cell: ({ getValue }) => (getValue() === "SERIALIZED" ? "IMEI / serial" : "Quantity"),
    }),
    col.accessor("sku", { header: "SKU", meta: { label: "SKU" }, cell: ({ getValue }) => <IdentifierChip value={getValue()} /> }),
    col.accessor("barcode", {
      header: "Barcode",
      meta: { label: "Barcode" },
      cell: ({ getValue }) => <span className="font-mono text-small text-muted-foreground">{getValue() ?? "—"}</span>,
    }),
    col.accessor("inStock", {
      header: "In stock",
      meta: { label: "In stock", align: "right" },
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
    }),
    col.accessor("defaultSellingPrice", {
      header: "Price",
      meta: { label: "Selling price", align: "right" },
      cell: ({ getValue }) => <Money value={getValue()} />,
    }),
    ...(showCost
      ? [
          col.display({
            id: "defaultCostPrice",
            header: "Last cost",
            meta: { label: "Last cost", align: "right" },
            cell: ({ row }) =>
              row.original.defaultCostPrice ? <Money value={row.original.defaultCostPrice} className="text-muted-foreground" /> : null,
          }),
        ]
      : []),
    col.accessor("warrantyMonths", {
      header: "Warranty",
      meta: { label: "Warranty", align: "right" },
      cell: ({ getValue }) => (getValue() > 0 ? `${getValue()} mo` : "—"),
    }),
    ...(canEdit
      ? [
          col.display({
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            enableHiding: false,
            cell: ({ row }) => (
              <Link
                href={hrefWith({ edit: row.original.id }, { keepPage: true })}
                scroll={false}
                aria-label={`Edit ${row.original.name}`}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Pencil aria-hidden className="size-4" />
              </Link>
            ),
          }),
        ]
      : []),
  ]);

  return (
    <DataTable
      caption="Product catalogue"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      toolbar={
        <>
          <SearchInput placeholder="Name, brand, SKU or barcode" label="Search products" />
          <ParamSelect param="category" label="Category" anyLabel="All categories" options={categories.map((c) => ({ value: c, label: c }))} />
          <ParamSelect
            param="type"
            label="Tracked by"
            anyLabel="Devices and accessories"
            options={[
              { value: "SERIALIZED", label: "Devices (IMEI / serial)" },
              { value: "NON_SERIALIZED", label: "Accessories (quantity)" },
            ]}
          />
        </>
      }
      empty={<EmptyState icon={PackageSearch} title="No products match" description="Try another search or clear the filters." />}
    />
  );
}
