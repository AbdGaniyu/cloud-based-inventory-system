"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Read/write query-string state (filters, tabs, open sheets). Changing any filter resets
 * pagination unless `keepPage` is set.
 */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hrefWith = useCallback(
    (updates: Record<string, string | null | undefined>, options: { keepPage?: boolean } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (!options.keepPage && !("page" in updates)) next.delete("page");
      const query = next.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );

  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>, options: { keepPage?: boolean } = {}) => {
      router.replace(hrefWith(updates, options), { scroll: false });
    },
    [hrefWith, router],
  );

  return { searchParams, setParams, hrefWith };
}
