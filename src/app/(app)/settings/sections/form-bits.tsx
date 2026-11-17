"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/action-result";

export function LabeledField({ label, hint, error, className, children }: { label: string; hint?: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-small font-medium", className)}>
      {label}
      {children}
      {error ? <span className="font-normal text-danger">{error}</span> : hint && <span className="font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Runs a server action with toast feedback, field errors and a refresh on success. */
export function useSave() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  function save<T>(action: () => Promise<ActionResult<T>>, success: string, onDone?: (data: T) => void) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      toast.success(success);
      onDone?.(result.data);
      router.refresh();
    });
  }

  return { save, pending, error, fieldError: (name: string) => fieldErrors[name]?.[0] };
}
