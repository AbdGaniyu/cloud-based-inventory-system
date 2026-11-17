import Link from "next/link";

import { cn } from "@/lib/utils";

export type FilterChip = { label: string; href: string; active: boolean; count?: number };

/** Segmented filter chips: selected is filled with --primary, others --secondary (mockups). */
export function FilterChips({ items, label }: { items: FilterChip[]; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {items.map((chip) => (
        <Link
          key={chip.href}
          href={chip.href}
          scroll={false}
          aria-current={chip.active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-body font-medium transition-colors duration-150",
            chip.active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-secondary-hover",
          )}
        >
          {chip.label}
          {chip.count !== undefined && (
            <span
              className={cn(
                "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                chip.active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-muted-foreground",
              )}
            >
              {chip.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
