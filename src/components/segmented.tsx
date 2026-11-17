"use client";

import { useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Segmented control (mockups: "Full payment | Installment"): a radio group with arrow-key
 * navigation, white selected segment on a --secondary track.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "default",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  label: string;
  size?: "default" | "lg";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const currentEnabled = enabled.findIndex((o) => o.value === options[index].value);
    const next = enabled[(currentEnabled + step + enabled.length) % enabled.length];
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-lg bg-secondary p-1">
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "flex-1 rounded-md px-3 font-medium transition-colors duration-150 disabled:opacity-40",
              size === "lg" ? "h-11 text-body" : "h-8 text-small",
              selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
