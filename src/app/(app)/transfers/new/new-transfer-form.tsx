"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowRight, Loader2, Lock, Minus, Plus, ScanBarcode, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { createTransferAction, loadTransferableStock, lookupTransferUnit } from "@/app/(app)/transfers/actions";
import { IdentifierChip } from "@/components/identifier-chip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConditionBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { type CreateTransferInput, createTransferSchema } from "@/lib/validators/transfer";
import type { TransferableStock } from "@/server/services/transfer.service";

type BranchOption = { id: string; name: string; code: string };
type Unit = TransferableStock["units"][number];
type FormValues = { fromBranchId?: string; toBranchId: string; driverName?: string; notes?: string; unitIds: string[]; accessories: { productId: string; quantity: number }[] };

const EMPTY_STOCK: TransferableStock = { units: [], accessories: [] };
const SEARCH_DEBOUNCE_MS = 250;

export function NewTransferForm({
  branches,
  fixedFrom,
  defaultFromId,
}: {
  branches: BranchOption[];
  fixedFrom: BranchOption | null;
  defaultFromId: string | null;
}) {
  const router = useRouter();
  const form = useForm<FormValues, unknown, CreateTransferInput>({
    resolver: zodResolver(createTransferSchema),
    defaultValues: { fromBranchId: fixedFrom?.id ?? defaultFromId ?? undefined, toBranchId: "", driverName: "", notes: "", unitIds: [], accessories: [] },
  });
  const [fromBranchId, unitIds, accessories] = useWatch({ control: form.control, name: ["fromBranchId", "unitIds", "accessories"] });
  const [stock, setStock] = useState<TransferableStock>(EMPTY_STOCK);
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([]);
  const [query, setQuery] = useState("");
  const [scan, setScan] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  // Reload what can leave the source branch whenever it or the search changes.
  useEffect(() => {
    if (!fromBranchId) return;
    const timer = setTimeout(() => {
      startLoading(async () => {
        const result = await loadTransferableStock({ fromBranchId, query: query || undefined });
        if (result.ok) setStock(result.data);
        else toast.error(result.error);
      });
    }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [fromBranchId, query]);

  const destinations = useMemo(() => branches.filter((b) => b.id !== fromBranchId), [branches, fromBranchId]);
  const fromBranch = branches.find((b) => b.id === fromBranchId) ?? fixedFrom;

  function changeSource(id: string) {
    form.setValue("fromBranchId", id);
    if (form.getValues("toBranchId") === id) form.setValue("toBranchId", "");
    form.setValue("unitIds", []);
    form.setValue("accessories", []);
    setSelectedUnits([]);
    setStock(EMPTY_STOCK);
  }

  function addUnit(unit: Unit) {
    if (unitIds.includes(unit.id)) return;
    form.setValue("unitIds", [...unitIds, unit.id], { shouldValidate: form.formState.isSubmitted });
    setSelectedUnits((list) => [...list, unit]);
  }

  function removeUnit(id: string) {
    form.setValue("unitIds", unitIds.filter((u) => u !== id));
    setSelectedUnits((list) => list.filter((u) => u.id !== id));
  }

  function setAccessoryQuantity(productId: string, quantity: number, available: number) {
    const clamped = Math.max(0, Math.min(available, Number.isFinite(quantity) ? Math.trunc(quantity) : 0));
    const rest = accessories.filter((a) => a.productId !== productId);
    form.setValue("accessories", clamped > 0 ? [...rest, { productId, quantity: clamped }] : rest, { shouldValidate: form.formState.isSubmitted });
  }

  async function onScan() {
    const value = scan.trim();
    if (!value || !fromBranchId) return;
    setScanError(null);
    const result = await lookupTransferUnit({ fromBranchId, identifier: value });
    setScan("");
    if (!result.ok) return setScanError(result.error);
    if (!result.data.ok) return setScanError(result.data.message);
    if (unitIds.includes(result.data.unit.id)) return setScanError(`${result.data.unit.identifier} is already on this transfer.`);
    addUnit(result.data.unit);
  }

  async function onSubmit(values: CreateTransferInput) {
    setFormError(null);
    const result = await createTransferAction(values);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    toast.success(`${result.data.number} created as a draft`);
    router.push(`/transfers/${result.data.id}`);
  }

  const accessoryQty = accessories.reduce((n, a) => n + a.quantity, 0);
  const blocker = !fromBranchId ? "Choose the sending branch" : unitIds.length + accessories.length === 0 ? "Add at least one item" : null;
  const accessoryName = (id: string) => stock.accessories.find((a) => a.productId === id)?.name ?? "Accessory";

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit, () => setFormError("Some details need attention — check the highlighted fields."))}
      noValidate
      className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div className="flex min-w-0 flex-col gap-6">
        {formError && (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="route-heading">
          <h2 id="route-heading" className="mb-4 text-h3">
            Route
          </h2>
          <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr]">
            {fixedFrom ? (
              <Field>
                <FieldLabel>From</FieldLabel>
                <p className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-body">
                  {fixedFrom.name} <span className="font-mono text-small text-muted-foreground">{fixedFrom.code}</span>
                  <Lock aria-label="Your branch" className="ml-auto size-3.5 text-subtle-foreground" />
                </p>
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="transfer-from">From</FieldLabel>
                <Select value={fromBranchId || undefined} onValueChange={changeSource}>
                  <SelectTrigger id="transfer-from" className="w-full">
                    <SelectValue placeholder="Sending branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} <span className="font-mono text-muted-foreground">· {b.code}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <ArrowRight aria-hidden className="mt-8 hidden size-4 text-muted-foreground md:block" />
            <Controller
              name="toBranchId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="transfer-to">To</FieldLabel>
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <SelectTrigger id="transfer-to" className="w-full" aria-invalid={fieldState.invalid}>
                      <SelectValue placeholder="Receiving branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {destinations.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} <span className="font-mono text-muted-foreground">· {b.code}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldState.error && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="transfer-driver">Driver (optional)</FieldLabel>
              <Input id="transfer-driver" {...form.register("driverName")} placeholder="Can also be set when shipping" />
            </Field>
            <Field>
              <FieldLabel htmlFor="transfer-notes">Notes (optional)</FieldLabel>
              <Input id="transfer-notes" {...form.register("notes")} />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="items-heading">
          <h2 id="items-heading" className="text-h3">
            Devices
          </h2>
          <p className="mb-4 text-small text-muted-foreground">
            Pick devices by exact IMEI or serial{fromBranch ? ` from ${fromBranch.name}` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-64 flex-1">
              <ScanBarcode aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onScan();
                  }
                }}
                disabled={!fromBranchId}
                placeholder="Scan IMEI or serial and press Enter"
                aria-label="Scan IMEI or serial"
                aria-describedby={scanError ? "scan-error" : undefined}
                className="pl-9 font-mono"
              />
            </div>
            <div className="relative min-w-56 flex-1">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={!fromBranchId}
                placeholder="Or search devices in stock"
                aria-label="Search devices in stock"
                className="pl-9"
              />
            </div>
          </div>
          {scanError && (
            <p id="scan-error" role="alert" className="mt-2 text-small text-danger">
              {scanError}
            </p>
          )}
          <ul className="mt-3 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border" aria-busy={loading}>
            {!fromBranchId ? (
              <li className="px-4 py-6 text-center text-body text-muted-foreground">Choose the sending branch first.</li>
            ) : stock.units.length === 0 ? (
              <li className="px-4 py-6 text-center text-body text-muted-foreground">{loading ? "Loading…" : "No devices in stock match."}</li>
            ) : (
              stock.units.map((unit) => {
                const added = unitIds.includes(unit.id);
                return (
                  <li key={unit.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{unit.productName}</p>
                      <p className="truncate text-small text-muted-foreground">{unit.spec || "—"}</p>
                    </div>
                    <IdentifierChip value={unit.identifier} copyable={false} />
                    <ConditionBadge condition={unit.condition} />
                    <Button type="button" size="sm" variant={added ? "ghost" : "secondary"} disabled={added} onClick={() => addUnit(unit)}>
                      {added ? "Added" : "Add"}
                    </Button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="acc-heading">
          <h2 id="acc-heading" className="mb-4 text-h3">
            Accessories
          </h2>
          {stock.accessories.length === 0 ? (
            <p className="text-body text-muted-foreground">{fromBranchId ? "No accessories on hand at this branch." : "Choose the sending branch first."}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {stock.accessories.map((a) => {
                const quantity = accessories.find((x) => x.productId === a.productId)?.quantity ?? 0;
                return (
                  <li key={a.productId} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{a.name}</p>
                      <p className="font-mono text-small text-muted-foreground">{a.sku}</p>
                    </div>
                    <span className="text-small text-muted-foreground tabular-nums">{a.available} available</span>
                    <div className="flex items-center gap-1">
                      <Button type="button" size="icon-sm" variant="secondary" aria-label={`One less ${a.name}`} disabled={quantity === 0} onClick={() => setAccessoryQuantity(a.productId, quantity - 1, a.available)}>
                        <Minus aria-hidden />
                      </Button>
                      <Input
                        value={quantity || ""}
                        onChange={(e) => setAccessoryQuantity(a.productId, e.target.valueAsNumber, a.available)}
                        type="number"
                        min={0}
                        max={a.available}
                        inputMode="numeric"
                        placeholder="0"
                        aria-label={`Quantity of ${a.name} to send`}
                        className="h-8 w-16 text-center tabular-nums"
                      />
                      <Button type="button" size="icon-sm" variant="secondary" aria-label={`One more ${a.name}`} disabled={quantity >= a.available} onClick={() => setAccessoryQuantity(a.productId, quantity + 1, a.available)}>
                        <Plus aria-hidden />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <aside className="sticky top-6 rounded-xl border border-border bg-card" aria-label="Manifest">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-h3">Manifest</h2>
          <p className="text-small text-muted-foreground tabular-nums">
            {unitIds.length} device{unitIds.length === 1 ? "" : "s"} · {accessoryQty} accessor{accessoryQty === 1 ? "y" : "ies"}
          </p>
        </div>
        <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">
          {selectedUnits.map((u) => (
            <li key={u.id} className="flex items-center gap-2 px-5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-small font-medium">{u.productName}</p>
                <p className="font-mono text-[12px] text-muted-foreground">{u.identifier}</p>
              </div>
              <button type="button" onClick={() => removeUnit(u.id)} aria-label={`Remove ${u.identifier}`} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
          {accessories.map((a) => (
            <li key={a.productId} className="flex items-center gap-2 px-5 py-2">
              <p className="min-w-0 flex-1 truncate text-small font-medium">{accessoryName(a.productId)}</p>
              <span className="text-small tabular-nums">× {a.quantity}</span>
              <button type="button" onClick={() => setAccessoryQuantity(a.productId, 0, 0)} aria-label={`Remove ${accessoryName(a.productId)}`} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
          {unitIds.length + accessories.length === 0 && <li className="px-5 py-6 text-center text-small text-muted-foreground">Nothing added yet.</li>}
        </ul>
        <div className="border-t border-border p-5">
          <Button type="submit" size="lg" className="w-full" disabled={Boolean(blocker) || form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 aria-hidden className="animate-spin" />}
            Create transfer
          </Button>
          <p className={cn("mt-2 text-center text-small", blocker ? "text-muted-foreground" : "text-transparent")} aria-live="polite">
            {blocker ?? "Saved as a draft — ship it from the next screen"}
          </p>
        </div>
      </aside>
    </form>
  );
}
