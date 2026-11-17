"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const COPIED_MS = 1500;

/** Mono identifier (IMEI, serial, invoice number) on a grey chip, with a copy button (DESIGN.md §4). */
export function IdentifierChip({ value, className, copyable = true }: { value: string; className?: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy(event: React.MouseEvent) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Clipboard can be blocked (insecure context, permissions); the value stays visible to copy by hand.
      setCopied(false);
    }
  }

  return (
    <span
      className={cn(
        "group/chip inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-secondary px-1.5 font-mono text-[12px] tabular-nums text-foreground",
        className,
      )}
    >
      <span className="truncate">{value}</span>
      {copyable && (
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? `Copied ${value}` : `Copy ${value}`}
          className="flex size-4 shrink-0 items-center justify-center rounded-sm text-subtle-foreground opacity-60 transition-opacity hover:text-foreground group-hover/chip:opacity-100 focus-visible:opacity-100"
        >
          {copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
        </button>
      )}
    </span>
  );
}
