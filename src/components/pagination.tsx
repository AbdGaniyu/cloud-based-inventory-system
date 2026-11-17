import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** Row count plus previous/next links that keep the other query params (DESIGN.md §4 tables). */
export function Pagination({
  page,
  pageSize,
  total,
  params,
  noun,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | undefined>;
  noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    if (target > 1) search.set("page", String(target));
    else search.delete("page");
    const query = search.toString();
    return query ? `?${query}` : "?";
  };
  const linkClass = "flex size-9 items-center justify-center rounded-md border border-border hover:bg-secondary";
  const disabledClass = "pointer-events-none opacity-40";

  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-small text-muted-foreground">
      <p className="tabular-nums">
        {total === 0 ? `No ${noun}` : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} ${noun}`}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            Page {page} of {pages}
          </span>
          <Link href={href(page - 1)} scroll={false} aria-label="Previous page" aria-disabled={page <= 1} className={cn(linkClass, page <= 1 && disabledClass)}>
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <Link href={href(page + 1)} scroll={false} aria-label="Next page" aria-disabled={page >= pages} className={cn(linkClass, page >= pages && disabledClass)}>
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
