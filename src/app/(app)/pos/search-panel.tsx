"use client";

import { ScanBarcode } from "lucide-react";
import { forwardRef } from "react";

import { Money } from "@/components/money";
import { ConditionBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { PosAccessory, PosCatalog, PosElsewhere, PosUnit } from "@/server/services/pos.service";

/** Striped placeholder until product photos exist (mockups). */
export function ProductTile({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block shrink-0 rounded-lg border border-border bg-[repeating-linear-gradient(135deg,var(--secondary)_0_6px,var(--background)_6px_12px)]",
        className ?? "size-14",
      )}
    />
  );
}

function Row({
  disabled,
  onAdd,
  label,
  children,
}: {
  disabled?: boolean;
  onAdd?: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled || !onAdd}
        aria-label={label}
        className={cn(
          "flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left transition-colors duration-150",
          onAdd && !disabled ? "hover:bg-surface" : "cursor-default",
          disabled && "opacity-50",
        )}
      >
        {children}
      </button>
    </li>
  );
}

function Price({ value, sub, subTone, title }: { value: string; sub: string; subTone: "success" | "muted"; title?: string }) {
  return (
    <span className="flex shrink-0 flex-col items-end border-l border-border pl-4" title={title}>
      <Money value={value} className="text-[17px] font-semibold" />
      <span className={cn("text-small whitespace-nowrap", subTone === "success" ? "text-success" : "text-muted-foreground")}>{sub}</span>
    </span>
  );
}

export const SearchField = forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void; onEnter: () => void; busy: boolean }>(
  function SearchField({ value, onChange, onEnter, busy }, ref) {
    return (
      <div className="relative">
        <ScanBarcode aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Barcode scanners type the code and press Enter.
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
          autoFocus
          autoComplete="off"
          aria-label="Scan IMEI or barcode, or search products"
          aria-busy={busy}
          placeholder="Scan IMEI or search products"
          className="h-14 w-full rounded-xl border-2 border-border bg-background pr-14 pl-12 text-[17px] placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-ring focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="absolute top-1/2 right-4 -translate-y-1/2 rounded-md border border-border bg-surface px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">
          F2
        </kbd>
      </div>
    );
  },
);

export function CatalogList({
  catalog,
  branchName,
  inCart,
  accessoryQtyInCart,
  onAddUnit,
  onAddAccessory,
  loading,
}: {
  catalog: PosCatalog;
  branchName: string;
  inCart: Set<string>;
  accessoryQtyInCart: Map<string, number>;
  onAddUnit: (unit: PosUnit) => void;
  onAddAccessory: (accessory: PosAccessory) => void;
  loading: boolean;
}) {
  const empty = catalog.units.length + catalog.elsewhere.length + catalog.accessories.length === 0;
  if (empty) {
    return (
      <p className="py-10 text-center text-body text-muted-foreground" aria-live="polite">
        {loading ? "Searching…" : "Nothing in stock matches. Check the spelling, or scan the IMEI."}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border" aria-busy={loading}>
      {catalog.units.map((unit) => {
        const added = inCart.has(unit.id);
        return (
          <Row key={unit.id} onAdd={added ? undefined : () => onAddUnit(unit)} label={`${unit.name} ${unit.identifier} — ${added ? "in cart" : "add to cart"}`}>
            <ProductTile />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[16px] font-medium text-foreground">{unit.name}</span>
                <ConditionBadge condition={unit.condition} />
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-small text-muted-foreground">
                {unit.spec && <span>{unit.spec}</span>}
                <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[12px] text-foreground">{unit.identifier}</span>
              </span>
            </span>
            <Price value={unit.price} sub={added ? "In cart" : `In stock · ${branchName}`} subTone={added ? "muted" : "success"} />
          </Row>
        );
      })}
      {catalog.accessories.map((acc) => {
        const inCartQty = accessoryQtyInCart.get(acc.productId) ?? 0;
        const left = acc.available - inCartQty;
        // Best-stocked other branch, plus how many more have it (full list in the tooltip).
        const others = [...acc.elsewhere].sort((a, b) => b.count - a.count);
        const elsewhere = others[0] ? `At ${others[0].branchName} · ${others[0].count}${others.length > 1 ? ` +${others.length - 1}` : ""}` : "";
        const elsewhereTitle = others.map((e) => `${e.branchName}: ${e.count}`).join(", ");
        return (
          <Row
            key={acc.productId}
            disabled={acc.available === 0}
            onAdd={left > 0 ? () => onAddAccessory(acc) : undefined}
            label={`${acc.name} — ${left > 0 ? "add one" : "none left here"}`}
          >
            <ProductTile />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium text-foreground">{acc.name}</span>
              <span className="mt-1 block font-mono text-small text-muted-foreground">{acc.sku}</span>
            </span>
            <Price
              value={acc.price}
              sub={acc.available === 0 ? elsewhere || "Out of stock" : inCartQty ? `${inCartQty} in cart · ${left} left` : `${acc.available} in stock · ${branchName}`}
              subTone={acc.available > 0 && !inCartQty ? "success" : "muted"}
              title={acc.available === 0 ? elsewhereTitle : undefined}
            />
          </Row>
        );
      })}
      {catalog.elsewhere.map((group: PosElsewhere) => (
        <Row key={group.key} disabled label={`${group.name} at ${group.branchName}, ${group.count} — not sellable here`}>
          <ProductTile />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[16px] font-medium">{group.name}</span>
              <ConditionBadge condition={group.condition} />
            </span>
            <span className="mt-1 block text-small text-muted-foreground">{group.spec || "—"}</span>
          </span>
          <Price value={group.price} sub={`At ${group.branchName} · ${group.count}`} subTone="muted" />
        </Row>
      ))}
    </ul>
  );
}

export function QuickPicks({
  items,
  accessoryQtyInCart,
  onAdd,
}: {
  items: PosAccessory[];
  accessoryQtyInCart: Map<string, number>;
  onAdd: (accessory: PosAccessory) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="quick-picks">
      <h3 id="quick-picks" className="mb-2 text-caption text-muted-foreground uppercase">
        Quick-pick accessories
      </h3>
      <ul className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
        {items.map((item) => {
          const left = item.available - (accessoryQtyInCart.get(item.productId) ?? 0);
          return (
            <li key={item.productId}>
              <button
                type="button"
                disabled={left <= 0}
                onClick={() => onAdd(item)}
                aria-label={`Add ${item.name}`}
                className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-background p-3 text-left transition-colors duration-150 hover:border-border-strong disabled:opacity-50"
              >
                <ProductTile className="size-11" />
                <span className="min-w-0">
                  <span className="line-clamp-2 text-body font-medium">{item.name}</span>
                  <span className="text-small text-muted-foreground">
                    <Money value={item.price} className="font-semibold text-foreground" /> · {left} left
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
