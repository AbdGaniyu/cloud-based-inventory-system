"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MessageCircle, MessageSquare, UserPlus, UserRound } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { addCustomer, findCustomers } from "@/app/(app)/pos/actions";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPhoneDisplay } from "@/lib/phone";
import { type QuickCustomerFormValues, type QuickCustomerInput, quickCustomerSchema } from "@/lib/validators/customer";
import type { CustomerOption } from "@/server/services/customer.service";

const SEARCH_DEBOUNCE_MS = 200;

function NewCustomerForm({ initialQuery, onCreated, onCancel }: { initialQuery: string; onCreated: (c: CustomerOption) => void; onCancel: () => void }) {
  const looksLikePhone = /^[\d\s+()-]{6,}$/.test(initialQuery);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<QuickCustomerFormValues, unknown, QuickCustomerInput>({
    resolver: zodResolver(quickCustomerSchema),
    defaultValues: {
      name: looksLikePhone ? "" : initialQuery,
      phone: looksLikePhone ? initialQuery : "",
      email: "",
      whatsappOptIn: true,
      smsOptIn: true,
    },
  });
  const { errors } = form.formState;

  async function onSubmit(values: QuickCustomerInput) {
    setError(null);
    const result = await addCustomer(values);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.data);
  }

  return (
    <form
      onSubmit={(e) => {
        e.stopPropagation();
        void form.handleSubmit(onSubmit)(e);
      }}
      noValidate
      className="flex flex-col gap-3 p-4"
    >
      <p className="text-h3">New customer</p>
      {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-small text-danger">{error}</p>}
      <Field data-invalid={Boolean(errors.name)}>
        <FieldLabel htmlFor="nc-name">Name</FieldLabel>
        <Input id="nc-name" autoFocus aria-invalid={Boolean(errors.name)} {...form.register("name")} />
        {errors.name && <FieldError errors={[errors.name]} />}
      </Field>
      <Field data-invalid={Boolean(errors.phone)}>
        <FieldLabel htmlFor="nc-phone">Phone</FieldLabel>
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-small text-muted-foreground">
            +234
          </span>
          <Input id="nc-phone" type="tel" inputMode="tel" placeholder="0803 123 4567" className="pl-12" aria-invalid={Boolean(errors.phone)} {...form.register("phone")} />
        </div>
        {errors.phone && <FieldError errors={[errors.phone]} />}
      </Field>
      <fieldset className="flex flex-wrap gap-4 text-body">
        <legend className="sr-only">Messages</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-4 accent-primary" {...form.register("whatsappOptIn")} /> WhatsApp messages
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-4 accent-primary" {...form.register("smsOptIn")} /> SMS
        </label>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 aria-hidden className="animate-spin" />}
          Add and select
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Back to search
        </Button>
      </div>
    </form>
  );
}

/** Customer card + picker (mockups: "Select customer · Required for receipts and payment plans · F4"). */
export function CustomerPicker({
  customer,
  onChange,
  open,
  onOpenChange,
}: {
  customer: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    if (!open || creating) return;
    const timer = setTimeout(() => {
      startLoading(async () => {
        const result = await findCustomers(query);
        if (result.ok) setResults(result.data);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open, creating]);

  function choose(c: CustomerOption) {
    onChange(c);
    setCreating(false);
    setQuery("");
    onOpenChange(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) setCreating(false);
      }}
    >
      <PopoverTrigger
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-3 text-left transition-colors duration-150 hover:border-border-strong"
        aria-label={customer ? `Customer: ${customer.name}. Change customer (F4)` : "Select customer (F4)"}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <UserRound aria-hidden className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          {customer ? (
            <>
              <span className="block truncate text-[16px] font-medium">{customer.name}</span>
              <span className="flex items-center gap-2 text-small text-muted-foreground">
                {formatPhoneDisplay(customer.phoneE164)}
                {customer.whatsappOptIn && <MessageCircle aria-label="WhatsApp on" className="size-3.5 text-success" />}
                {customer.smsOptIn && <MessageSquare aria-label="SMS on" className="size-3.5 text-info" />}
              </span>
            </>
          ) : (
            <>
              <span className="block text-[16px] font-medium">Select customer</span>
              <span className="block text-small text-muted-foreground">Required for receipts and payment plans</span>
            </>
          )}
        </span>
        <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">F4</kbd>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-80 p-0 shadow-popover">
        {creating ? (
          <NewCustomerForm initialQuery={query} onCreated={choose} onCancel={() => setCreating(false)} />
        ) : (
          <Command shouldFilter={false}>
            <CommandInput placeholder="Name or phone number" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>{loading ? "Searching…" : "No customer found."}</CommandEmpty>
              {results.length > 0 && (
                <CommandGroup heading={query.trim().length >= 2 ? "Matches" : "Recent customers"}>
                  {results.map((c) => (
                    <CommandItem key={c.id} value={c.id} onSelect={() => choose(c)}>
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-small text-muted-foreground tabular-nums">{formatPhoneDisplay(c.phoneE164)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
            <div className="border-t border-border p-2">
              <Button type="button" variant="secondary" className="w-full" onClick={() => setCreating(true)}>
                <UserPlus aria-hidden data-icon="inline-start" /> New customer
              </Button>
            </div>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
