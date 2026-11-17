"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, Lock, PackagePlus, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { Controller, FormProvider, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { AccessoryLine } from "@/app/(app)/inventory/intake/accessory-line";
import { checkIntakeIdentifiers, receiveStock } from "@/app/(app)/inventory/intake/actions";
import { DeviceLine } from "@/app/(app)/inventory/intake/device-line";
import { NewSupplierDialog } from "@/app/(app)/inventory/intake/new-supplier-dialog";
import { Money } from "@/components/money";
import { Segmented } from "@/components/segmented";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STORE } from "@/config/store";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { addDays, parseCalendarDate } from "@/lib/dates";
import { normalizeIdentifier } from "@/lib/identifiers";
import { type Money as MoneyValue, money, ZERO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { type IntakeFormValues, type IntakeInput, intakeSchema, NET_DAYS, type NetDays } from "@/lib/validators/intake";
import type { IdentifierStatus, IntakeProductOption } from "@/server/services/intake.service";

type Option = { id: string; name: string; code?: string };

const METHOD_LABELS: Record<PaymentMethod, string> = { BANK_TRANSFER: "Bank transfer", CASH: "Cash", POS_CARD: "POS card" };
const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Lenient money parse for the live summary: half-typed values count as zero. */
function moneyOrZero(value: string | undefined): MoneyValue {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  return MONEY_PATTERN.test(cleaned) ? money(cleaned) : ZERO;
}

function Section({ step, title, description, children }: { step: number; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby={`intake-step-${step}`}>
      <header className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-primary text-caption text-primary-foreground">
          {step}
        </span>
        <div>
          <h2 id={`intake-step-${step}`} className="text-h3">
            {title}
          </h2>
          {description && <p className="text-small text-muted-foreground">{description}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function IntakeForm({
  suppliers: initialSuppliers,
  products,
  branches,
  fixedBranch,
  defaultBranchId,
  canPay,
  canEditPrices,
  today,
}: {
  suppliers: Option[];
  products: IntakeProductOption[];
  branches: Option[];
  fixedBranch: Option | null;
  defaultBranchId: string | null;
  canPay: boolean;
  canEditPrices: boolean;
  today: string;
}) {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [statuses, setStatuses] = useState<Record<string, IdentifierStatus>>({});
  const [checking, startChecking] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<IntakeFormValues, unknown, IntakeInput>({
    resolver: zodResolver(intakeSchema),
    defaultValues: {
      supplierId: "",
      branchId: fixedBranch?.id ?? defaultBranchId ?? undefined,
      supplierReference: "",
      receivedOn: today,
      notes: "",
      payment: canPay ? { mode: "PAID_IN_FULL", method: "BANK_TRANSFER", reference: "" } : { mode: "CREDIT", netDays: 30 },
      serializedLines: [],
      accessoryLines: [],
    },
  });
  const { control } = form;
  const devices = useFieldArray({ control, name: "serializedLines" });
  const accessories = useFieldArray({ control, name: "accessoryLines" });
  const [serializedLines, accessoryLines, payment, receivedOn] = useWatch({
    control,
    name: ["serializedLines", "accessoryLines", "payment", "receivedOn"],
  });

  const serializedProducts = useMemo(() => products.filter((p) => p.trackingType === "SERIALIZED"), [products]);
  const accessoryProducts = useMemo(() => products.filter((p) => p.trackingType === "NON_SERIALIZED"), [products]);

  /** Re-validates every identifier on the form against the server (format, repeats, already in stock). */
  const refreshStatuses = useCallback(() => {
    const currentIdentifiers = () => form.getValues("serializedLines").flatMap((line) => line.units.map((u) => u.identifier));
    // Read after react-hook-form has applied the append/remove.
    queueMicrotask(() => {
      const values = currentIdentifiers();
      if (!values.length) {
        setStatuses({});
        return;
      }
      startChecking(async () => {
        const result = await checkIntakeIdentifiers(values);
        // A newer edit superseded this check; its own check will land.
        if (currentIdentifiers().join("|") !== values.join("|")) return;
        if (result.ok) setStatuses(result.data);
        else toast.error(result.error);
      });
    });
  }, [form]);

  // Live summary.
  const totalCost = [
    ...(serializedLines ?? []).flatMap((line) => (line.units ?? []).map((u) => moneyOrZero(u.costPrice))),
    ...(accessoryLines ?? []).map((line) => moneyOrZero(line.unitCost).times(Number.isFinite(line.quantity) ? line.quantity : 0)),
  ].reduce((acc, v) => acc.plus(v), ZERO);
  const paidNow =
    payment?.mode === "PAID_IN_FULL" ? totalCost : payment?.mode === "PARTIAL_DEPOSIT" ? moneyOrZero(payment.amountPaid) : ZERO;
  const balance = totalCost.minus(paidNow);
  const deviceCount = (serializedLines ?? []).reduce((n, l) => n + (l.units?.length ?? 0), 0);
  const accessoryCount = (accessoryLines ?? []).reduce((n, l) => n + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
  const allIdentifiers = (serializedLines ?? []).flatMap((l) => (l.units ?? []).map((u) => normalizeIdentifier(u.identifier)));
  const flagged = allIdentifiers.filter((id) => statuses[id] && statuses[id].status !== "ok").length;
  const unchecked = allIdentifiers.filter((id) => !statuses[id]).length;
  const netDays = payment && "netDays" in payment ? payment.netDays : null;
  const dueDate = netDays && receivedOn ? addDays(parseCalendarDate(receivedOn), netDays) : null;

  const blocker =
    deviceCount + accessoryCount === 0
      ? "Add at least one item"
      : flagged > 0
        ? `Remove or rescan ${flagged} flagged IMEI${flagged === 1 ? "" : "s"}/serial${flagged === 1 ? "" : "s"}`
        : checking || unchecked > 0
          ? "Checking IMEIs…"
          : null;

  function setMode(mode: "PAID_IN_FULL" | "PARTIAL_DEPOSIT" | "CREDIT") {
    const method = payment && "method" in payment ? payment.method : "BANK_TRANSFER";
    const days: NetDays = netDays ?? 30;
    form.setValue(
      "payment",
      mode === "PAID_IN_FULL"
        ? { mode, method, reference: "" }
        : mode === "PARTIAL_DEPOSIT"
          ? { mode, netDays: days, amountPaid: "", method, reference: "" }
          : { mode, netDays: days },
      { shouldValidate: form.formState.isSubmitted },
    );
  }

  function setNetDays(days: NetDays) {
    const current = form.getValues("payment");
    if (current.mode === "PARTIAL_DEPOSIT") form.setValue("payment", { ...current, netDays: days });
    else if (current.mode === "CREDIT") form.setValue("payment", { ...current, netDays: days });
  }

  function onInvalid() {
    setFormError("Some details need attention — check the highlighted fields.");
  }

  async function onSubmit(values: IntakeInput) {
    setFormError(null);
    const result = await receiveStock(values);
    if (!result.ok) {
      setFormError(result.error);
      for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(name as keyof IntakeFormValues, { message: messages[0] });
      }
      refreshStatuses();
      return;
    }
    toast.success(`${result.data.number} saved · ${deviceCount + accessoryCount} items received`);
    router.push(`/inventory/intake/${result.data.id}`);
  }

  const errors = form.formState.errors;

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} noValidate className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {formError && (
            <Alert variant="destructive" role="alert">
              <AlertCircle aria-hidden />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <Section step={1} title="Supplier and destination">
            <div className="grid gap-4 md:grid-cols-2">
              <Controller
                name="supplierId"
                control={control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="intake-supplier">Supplier</FieldLabel>
                    <div className="flex gap-2">
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <SelectTrigger id="intake-supplier" className="flex-1" aria-invalid={fieldState.invalid}>
                          <SelectValue placeholder="Choose a supplier" />
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <NewSupplierDialog
                        onCreated={(supplier) => {
                          setSuppliers((list) => [...list, supplier].sort((a, b) => a.name.localeCompare(b.name)));
                          field.onChange(supplier.id);
                        }}
                      />
                    </div>
                    {fieldState.error && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
              {fixedBranch ? (
                <Field>
                  <FieldLabel>Receiving branch</FieldLabel>
                  <p className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-body">
                    {fixedBranch.name} <span className="font-mono text-small text-muted-foreground">{fixedBranch.code}</span>
                    <Lock aria-label="Fixed to your branch" className="ml-auto size-3.5 text-subtle-foreground" />
                  </p>
                </Field>
              ) : (
                <Controller
                  name="branchId"
                  control={control}
                  render={({ field }) => (
                    <Field data-invalid={Boolean(formError && !field.value)}>
                      <FieldLabel htmlFor="intake-branch">Receiving branch</FieldLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <SelectTrigger id="intake-branch" className="w-full">
                          <SelectValue placeholder="Choose the branch receiving this stock" />
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
                />
              )}
              <Field data-invalid={Boolean(errors.supplierReference)}>
                <FieldLabel htmlFor="intake-reference">Supplier invoice / delivery note (optional)</FieldLabel>
                <Input id="intake-reference" placeholder="e.g. LTW-8020" {...form.register("supplierReference")} />
              </Field>
              <Field data-invalid={Boolean(errors.receivedOn)}>
                <FieldLabel htmlFor="intake-date">Received on</FieldLabel>
                <Input id="intake-date" type="date" max={today} {...form.register("receivedOn")} />
                {errors.receivedOn && <FieldError errors={[errors.receivedOn]} />}
              </Field>
            </div>
          </Section>

          <Section step={2} title="Items" description="Devices are recorded one by one by IMEI or serial; accessories by quantity.">
            <div className="flex flex-col gap-4">
              {devices.fields.map((field, index) => (
                <DeviceLine
                  key={field.id}
                  index={index}
                  control={control}
                  products={serializedProducts}
                  statuses={statuses}
                  checking={checking}
                  onIdentifiersChanged={refreshStatuses}
                  onRemove={() => {
                    devices.remove(index);
                    refreshStatuses();
                  }}
                />
              ))}
              {accessories.fields.map((field, index) => (
                <AccessoryLine
                  key={field.id}
                  index={index}
                  control={control}
                  products={accessoryProducts}
                  canEditPrices={canEditPrices}
                  onRemove={() => accessories.remove(index)}
                />
              ))}
              {devices.fields.length + accessories.fields.length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-body text-muted-foreground">
                  Add a device line to scan IMEIs, or an accessory line for counted stock.
                </p>
              )}
              {errors.serializedLines?.root?.message && <p className="text-small text-danger">{errors.serializedLines.root.message}</p>}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => devices.append({ productId: "", units: [] })}
                >
                  <Smartphone aria-hidden data-icon="inline-start" /> Add device line
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    accessories.append({ productId: "", quantity: 1, unitCost: "", unitSellingPrice: "" })
                  }
                >
                  <PackagePlus aria-hidden data-icon="inline-start" /> Add accessory line
                </Button>
              </div>
            </div>
          </Section>

          <Section step={3} title="Payment">
            <div className="flex flex-col gap-4">
              {canPay ? (
                <Segmented
                  label="How this stock is paid for"
                  value={payment?.mode ?? "CREDIT"}
                  onChange={setMode}
                  options={[
                    { value: "PAID_IN_FULL", label: "Paid in full" },
                    { value: "PARTIAL_DEPOSIT", label: "Partial deposit" },
                    { value: "CREDIT", label: "On credit" },
                  ]}
                />
              ) : (
                <p className="flex items-start gap-2 rounded-lg bg-surface p-3 text-small text-muted-foreground">
                  <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  Stock you receive is recorded on credit. Payments to suppliers are recorded by the owner.
                </p>
              )}

              {netDays !== null && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Credit terms</FieldLabel>
                    <Segmented
                      label="Credit terms"
                      value={String(netDays)}
                      onChange={(value) => setNetDays(Number(value) as NetDays)}
                      options={NET_DAYS.map((d) => ({ value: String(d), label: `Net ${d}` }))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Balance due</FieldLabel>
                    <p className="flex h-9 items-center text-body font-medium tabular-nums">
                      {dueDate ? dateFormat.format(new Date(`${dueDate}T00:00:00Z`)) : "—"}
                    </p>
                  </Field>
                </div>
              )}

              {payment && payment.mode !== "CREDIT" && (
                <div className="grid gap-4 md:grid-cols-3">
                  {payment.mode === "PARTIAL_DEPOSIT" && (
                    <Controller
                      name="payment.amountPaid"
                      control={control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor="intake-paid">Deposit paid now</FieldLabel>
                          <div className="relative">
                            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
                              {STORE.currencySymbol}
                            </span>
                            <Input id="intake-paid" {...field} value={field.value ?? ""} inputMode="decimal" className="pl-7 text-right tabular-nums" aria-invalid={fieldState.invalid} />
                          </div>
                          {fieldState.error && <FieldError errors={[fieldState.error]} />}
                        </Field>
                      )}
                    />
                  )}
                  <Controller
                    name="payment.method"
                    control={control}
                    render={({ field }) => (
                      <Field>
                        <FieldLabel htmlFor="intake-method">Paid by</FieldLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="intake-method" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                              <SelectItem key={m} value={m}>
                                {METHOD_LABELS[m]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  />
                  <Field>
                    <FieldLabel htmlFor="intake-payref">Payment reference (optional)</FieldLabel>
                    <Input id="intake-payref" {...form.register("payment.reference")} />
                  </Field>
                </div>
              )}
            </div>
          </Section>
        </div>

        <aside className="sticky top-6 rounded-xl border border-border bg-card" aria-label="Intake summary">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-h3">Summary</h2>
          </div>
          <dl className="flex flex-col gap-2 px-5 py-4 text-body">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Devices</dt>
              <dd className="tabular-nums">{deviceCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Accessory items</dt>
              <dd className="tabular-nums">{accessoryCount}</dd>
            </div>
            <div className="mt-2 flex justify-between border-t border-dashed border-border pt-3">
              <dt className="text-muted-foreground">Total cost</dt>
              <dd>
                <Money value={totalCost} className="font-medium" />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Paid now</dt>
              <dd>
                <Money value={paidNow} />
              </dd>
            </div>
            <div className="mt-2 flex items-end justify-between border-t border-border pt-3">
              <dt className="font-medium">Added to supplier balance</dt>
              <dd>
                <Money value={balance.isNegative() ? ZERO : balance} className="text-h2 font-semibold" />
              </dd>
            </div>
          </dl>
          <div className="border-t border-border p-5">
            <Button type="submit" size="lg" className="w-full" disabled={Boolean(blocker) || form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 aria-hidden className="animate-spin" />}
              Receive stock
            </Button>
            <p className={cn("mt-2 text-center text-small", blocker ? "text-muted-foreground" : "text-transparent")} aria-live="polite">
              {blocker ?? "Ready"}
            </p>
          </div>
        </aside>
      </form>
    </FormProvider>
  );
}
