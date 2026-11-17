"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useUrlParams } from "@/hooks/use-url-params";

const DEBOUNCE_MS = 300;

/** Toolbar search bound to a query param, debounced. */
export function SearchInput({ param = "q", placeholder, label }: { param?: string; placeholder: string; label: string }) {
  const { searchParams, setParams } = useUrlParams();
  const urlValue = searchParams.get(param) ?? "";
  const [value, setValue] = useState(urlValue);
  const lastSent = useRef(urlValue);

  useEffect(() => {
    if (value === lastSent.current) return;
    const timer = setTimeout(() => {
      lastSent.current = value;
      setParams({ [param]: value.trim() || null });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, param, setParams]);

  return (
    <div className="relative w-full max-w-xs">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-input bg-background pr-8 pl-9 text-body placeholder:text-subtle-foreground hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setValue("")}
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  );
}
