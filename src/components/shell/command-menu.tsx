"use client";

import { Package, Search, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { paletteSearch } from "@/app/(app)/search-actions";
import type { NavGroup } from "@/components/shell/nav-config";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { StockSearchResult } from "@/server/services/inventory.service";

const EMPTY: StockSearchResult = { units: [], products: [] };
const SEARCH_DEBOUNCE_MS = 200;

/** ⌘K / Ctrl-K palette: pages, plus IMEI / serial / SKU lookup. */
export function CommandMenu({ nav }: { nav: NavGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult>(EMPTY);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const result = await paletteSearch(q);
        setResults(result.ok ? result.data : EMPTY);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  function changeOpen(value: boolean) {
    setOpen(value);
    if (!value) {
      setQuery("");
      setResults(EMPTY);
    }
  }

  function go(href: string) {
    changeOpen(false);
    router.push(href);
  }

  const q = query.trim().toLowerCase();
  const pages = nav
    .flatMap((g) => g.items)
    .filter((item) => !q || item.label.toLowerCase().includes(q) || (item.title ?? "").toLowerCase().includes(q));
  const showRemote = q.length >= 2;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search invoice, phone or IMEI (Ctrl K)"
        className="flex h-9 w-[300px] items-center gap-2 rounded-lg border border-border bg-background px-3 text-body text-subtle-foreground transition-colors duration-150 hover:border-border-strong max-xl:w-9 max-xl:justify-center max-xl:px-0"
      >
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate max-xl:hidden">Search invoice, phone or IMEI</span>
        <kbd className="ml-auto rounded-md border border-border bg-surface px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground max-xl:hidden">
          ⌘K
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={changeOpen} title="Search" description="Search stock or jump to a page">
        <Command shouldFilter={false}>
          <CommandInput placeholder="IMEI, serial, SKU, product or page…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              {showRemote && searching
                ? "Searching…"
                : "No matches. Invoice and phone search arrive with the invoices and customers screens."}
            </CommandEmpty>
            {showRemote && results.units.length > 0 && (
              <CommandGroup heading="Devices">
                {results.units.map((u) => (
                  <CommandItem key={u.id} value={`unit-${u.id}`} onSelect={() => go(`/inventory?unit=${u.id}`)}>
                    <Smartphone aria-hidden className="size-4" />
                    <span className="truncate">{u.productName}</span>
                    <span className="ml-auto font-mono text-small text-muted-foreground">
                      {u.identifier} · {u.branchCode}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showRemote && results.products.length > 0 && (
              <CommandGroup heading="Products">
                {results.products.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`product-${p.id}`}
                    onSelect={() => go(`/inventory?tab=products&q=${encodeURIComponent(p.sku)}`)}
                  >
                    <Package aria-hidden className="size-4" />
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto font-mono text-small text-muted-foreground">{p.sku}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {pages.length > 0 && (
              <CommandGroup heading="Pages">
                {pages.map((item) => {
                  const Icon = NAV_ICONS[item.icon];
                  return (
                    <CommandItem key={item.href} value={`page-${item.href}`} onSelect={() => go(item.href)}>
                      <Icon aria-hidden className="size-4" />
                      {item.title ?? item.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
