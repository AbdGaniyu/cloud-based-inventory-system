"use client";

import {
  type ColumnHelper,
  type RowData,
  columnVisibilityFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { Columns3 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type DataColumnMeta = {
  /** Right-align numeric columns (DESIGN.md §4). */
  align?: "right";
  /** Label shown in the column visibility menu. */
  label?: string;
  headerClassName?: string;
  cellClassName?: string;
};

const features = tableFeatures({ columnVisibilityFeature, columnMeta: {} as DataColumnMeta });
type Features = typeof features;

export function columnHelper<T extends RowData>(): ColumnHelper<Features, T> {
  return createColumnHelper<Features, T>();
}

export type DataColumns<T extends RowData> = ReturnType<ColumnHelper<Features, T>["columns"]>;

/**
 * Table per DESIGN.md §4: sticky header on --surface, hairline rows, hover tint, no zebra.
 * Rows can open a detail view (click or Enter); numbers are right-aligned with tabular numerals.
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  onRowOpen,
  rowLabel,
  rowClassName,
  empty,
  caption,
  toolbar,
}: {
  columns: DataColumns<T>;
  data: T[];
  getRowId: (row: T) => string;
  onRowOpen?: (row: T) => void;
  rowLabel?: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  empty: React.ReactNode;
  caption: string;
  toolbar?: React.ReactNode;
}) {
  const table = useTable({ features, columns, data, getRowId: (row) => getRowId(row) });
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide() && c.columnDef.meta?.label);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {toolbar}
        {hideable.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="ml-auto flex h-9 items-center gap-2 rounded-md border border-border px-3 text-body hover:bg-secondary">
              <Columns3 aria-hidden className="size-4" /> Columns
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="shadow-popover">
              <DropdownMenuLabel className="text-caption uppercase text-subtle-foreground">Show columns</DropdownMenuLabel>
              {hideable.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}
                  onSelect={(event) => event.preventDefault()}
                >
                  {column.columnDef.meta?.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-small">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-surface">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-border">
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={cn(
                        "h-10 px-3 text-left text-caption font-medium whitespace-nowrap text-muted-foreground uppercase",
                        meta?.align === "right" && "text-right",
                        meta?.headerClassName,
                      )}
                    >
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className="p-0">
                  {empty}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={onRowOpen ? 0 : undefined}
                  aria-label={onRowOpen && rowLabel ? rowLabel(row.original) : undefined}
                  onClick={onRowOpen ? () => onRowOpen(row.original) : undefined}
                  onKeyDown={
                    onRowOpen
                      ? (event) => {
                          if (event.key === "Enter") onRowOpen(row.original);
                        }
                      : undefined
                  }
                  className={cn(
                    "h-11 border-b border-border transition-colors duration-150 last:border-b-0",
                    onRowOpen && "cursor-pointer hover:bg-surface focus-visible:bg-surface",
                    rowClassName?.(row.original),
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-3 py-2 align-middle",
                          meta?.align === "right" && "text-right tabular-nums",
                          meta?.cellClassName,
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
