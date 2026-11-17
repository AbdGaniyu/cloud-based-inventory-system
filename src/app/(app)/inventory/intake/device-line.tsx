"use client";

import { AlertCircle, CheckCircle2, ClipboardPaste, Loader2, ScanBarcode, Trash2, X } from "lucide-react";
import { useState } from "react";
import { type Control, Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONDITION_LABELS } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { UnitCondition } from "@/generated/prisma/enums";
import { normalizeIdentifier, parseIdentifierList } from "@/lib/identifiers";
import { cn } from "@/lib/utils";
import type { IntakeFormValues } from "@/lib/validators/intake";
import type { IdentifierStatus, IntakeProductOption } from "@/server/services/intake.service";

type Defaults = {
  condition: UnitCondition;
  color: string;
  storage: string;
  ram: string;
  costPrice: string;
  sellingPrice: string;
};

const EMPTY_DEFAULTS: Defaults = { condition: "BRAND_NEW", color: "", storage: "", ram: "", costPrice: "", sellingPrice: "" };

const cellInput = "h-8 px-2 text-small";
const SPEC_LABELS = { color: "Colour", storage: "Storage", ram: "RAM" } as const;

function StatusIcon({ status, checking }: { status: IdentifierStatus | undefined; checking: boolean }) {
  if (!status) {
    return checking ? <Loader2 aria-label="Checking" className="size-4 animate-spin text-muted-foreground" /> : null;
  }
  if (status.status === "ok") return <CheckCircle2 aria-label={`Valid ${status.kind}`} className="size-4 text-success" />;
  return <AlertCircle aria-hidden className="size-4 text-danger" />;
}

/** One serialized product on the intake: scan/paste IMEIs, set specs and prices per unit or for all. */
export function DeviceLine({
  index,
  control,
  products,
  statuses,
  checking,
  onIdentifiersChanged,
  onRemove,
}: {
  index: number;
  control: Control<IntakeFormValues>;
  products: IntakeProductOption[];
  statuses: Record<string, IdentifierStatus>;
  checking: boolean;
  onIdentifiersChanged: () => void;
  onRemove: () => void;
}) {
  const form = useFormContext<IntakeFormValues>();
  const units = useFieldArray({ control, name: `serializedLines.${index}.units` });
  const productId = useWatch({ control, name: `serializedLines.${index}.productId` });
  const product = products.find((p) => p.id === productId);
  const [scan, setScan] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [defaults, setDefaults] = useState<Defaults>(EMPTY_DEFAULTS);

  function addIdentifiers(values: string[]) {
    if (!values.length) return;
    units.append(
      values.map((identifier) => ({
        identifier,
        condition: defaults.condition,
        color: defaults.color,
        storage: defaults.storage,
        ram: defaults.ram,
        batteryHealth: null,
        costPrice: defaults.costPrice || product?.defaultCostPrice || "",
        sellingPrice: defaults.sellingPrice || product?.defaultSellingPrice || "",
      })),
      { shouldFocus: false },
    );
    onIdentifiersChanged();
  }

  // Writes only the fields that have a value in the "Apply to all" row; other edits are kept.
  function applyToAll() {
    const options = { shouldDirty: true, shouldValidate: form.formState.isSubmitted };
    units.fields.forEach((_, i) => {
      const base = `serializedLines.${index}.units.${i}` as const;
      form.setValue(`${base}.condition`, defaults.condition, options);
      for (const key of ["color", "storage", "ram", "costPrice", "sellingPrice"] as const) {
        if (defaults[key]) form.setValue(`${base}.${key}`, defaults[key], options);
      }
    });
  }

  const flagged = units.fields.filter((u) => {
    const status = statuses[normalizeIdentifier(u.identifier)];
    return status && status.status !== "ok";
  }).length;

  return (
    <div className="rounded-xl border border-border">
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <Controller
          name={`serializedLines.${index}.productId`}
          control={control}
          render={({ field, fieldState }) => (
            <div className="min-w-64 flex-1">
              <label htmlFor={`device-${index}-product`} className="mb-1.5 block text-small font-medium">
                Device
              </label>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger id={`device-${index}-product`} className="w-full" aria-invalid={fieldState.invalid}>
                  <SelectValue placeholder="Choose a device model" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} <span className="font-mono text-muted-foreground">· {p.sku}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldState.error && <p className="mt-1 text-small text-danger">Choose a device model</p>}
            </div>
          )}
        />
        <div className="text-small text-muted-foreground">
          {units.fields.length} unit{units.fields.length === 1 ? "" : "s"}
          {flagged > 0 && <span className="ml-2 font-medium text-danger">· {flagged} flagged</span>}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Remove this device line">
          <Trash2 aria-hidden />
        </Button>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-72 flex-1">
            <ScanBarcode aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={scan}
              onChange={(event) => setScan(event.target.value)}
              onKeyDown={(event) => {
                // Scanners type the code then press Enter.
                if (event.key === "Enter") {
                  event.preventDefault();
                  addIdentifiers(parseIdentifierList(scan));
                  setScan("");
                }
              }}
              disabled={!productId}
              placeholder={productId ? "Scan an IMEI or serial and press Enter" : "Choose a device first"}
              aria-label="Scan IMEI or serial"
              className="pl-9 font-mono"
            />
          </div>
          <Button type="button" variant="secondary" disabled={!productId} onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}>
            <ClipboardPaste aria-hidden data-icon="inline-start" /> Paste a list
          </Button>
        </div>
        {pasteOpen && (
          <div className="flex flex-col gap-2">
            <Textarea
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              rows={5}
              placeholder={"One IMEI or serial per line\n356938035643809\n490154203237518"}
              aria-label="Paste IMEIs or serials, one per line"
              className="font-mono text-small"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => {
                  addIdentifiers(parseIdentifierList(paste));
                  setPaste("");
                  setPasteOpen(false);
                }}
              >
                Add {parseIdentifierList(paste).length || ""} to list
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPasteOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {units.fields.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[960px] text-small">
              <caption className="sr-only">Units on this line</caption>
              <thead className="bg-surface text-caption text-muted-foreground uppercase">
                <tr className="border-b border-border">
                  <th scope="col" className="h-9 px-2 text-left font-medium">IMEI / serial</th>
                  <th scope="col" className="px-2 text-left font-medium">Condition</th>
                  <th scope="col" className="px-2 text-left font-medium">Colour</th>
                  <th scope="col" className="px-2 text-left font-medium">Storage</th>
                  <th scope="col" className="px-2 text-left font-medium">RAM</th>
                  <th scope="col" className="w-20 px-2 text-right font-medium">Battery %</th>
                  <th scope="col" className="w-32 px-2 text-right font-medium">Cost</th>
                  <th scope="col" className="w-32 px-2 text-right font-medium">Selling price</th>
                  <th scope="col" className="w-10 px-2"><span className="sr-only">Remove</span></th>
                </tr>
                <tr className="border-b border-border bg-background normal-case">
                  <td className="px-2 py-1.5 text-small font-medium text-foreground">
                    <Button type="button" size="sm" variant="secondary" onClick={applyToAll}>
                      Apply to all
                    </Button>
                  </td>
                  <td className="px-2 py-1.5">
                    <Select value={defaults.condition} onValueChange={(v) => setDefaults((d) => ({ ...d, condition: v as UnitCondition }))}>
                      <SelectTrigger size="sm" aria-label="Condition for all" className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.values(UnitCondition).map((c) => (
                          <SelectItem key={c} value={c}>
                            {CONDITION_LABELS[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  {(["color", "storage", "ram"] as const).map((key) => (
                    <td key={key} className="px-2 py-1.5">
                      <Input value={defaults[key]} onChange={(e) => setDefaults((d) => ({ ...d, [key]: e.target.value }))} aria-label={`${SPEC_LABELS[key]} for all`} placeholder="All…" className={cellInput} />
                    </td>
                  ))}
                  <td />
                  {(["costPrice", "sellingPrice"] as const).map((key) => (
                    <td key={key} className="px-2 py-1.5">
                      <Input value={defaults[key]} onChange={(e) => setDefaults((d) => ({ ...d, [key]: e.target.value }))} aria-label={`${key === "costPrice" ? "Cost" : "Selling price"} for all`} inputMode="decimal" placeholder="All…" className={cn(cellInput, "text-right tabular-nums")} />
                    </td>
                  ))}
                  <td />
                </tr>
              </thead>
              <tbody>
                {units.fields.map((unit, i) => {
                  const status = statuses[normalizeIdentifier(unit.identifier)];
                  const bad = status && status.status !== "ok";
                  const base = `serializedLines.${index}.units.${i}` as const;
                  return (
                    <tr key={unit.id} className={cn("border-b border-border last:border-b-0", bad && "bg-danger-bg")}>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <StatusIcon status={status} checking={checking} />
                          <span className="font-mono">{normalizeIdentifier(unit.identifier)}</span>
                        </div>
                        {bad && <p className="mt-0.5 text-[12px] text-danger">{"message" in status ? status.message : ""}</p>}
                      </td>
                      <td className="px-2 py-1.5">
                        <Controller
                          name={`${base}.condition`}
                          control={control}
                          render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger size="sm" aria-label="Condition" className="w-36">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.values(UnitCondition).map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {CONDITION_LABELS[c]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </td>
                      {(["color", "storage", "ram"] as const).map((key) => (
                        <td key={key} className="px-2 py-1.5">
                          <Controller
                            name={`${base}.${key}`}
                            control={control}
                            render={({ field }) => <Input {...field} value={field.value ?? ""} aria-label={SPEC_LABELS[key]} className={cellInput} />}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <Controller
                          name={`${base}.batteryHealth`}
                          control={control}
                          render={({ field, fieldState }) => (
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              inputMode="numeric"
                              aria-label="Battery health %"
                              aria-invalid={fieldState.invalid}
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.valueAsNumber)}
                              onBlur={field.onBlur}
                              className={cn(cellInput, "text-right tabular-nums")}
                            />
                          )}
                        />
                      </td>
                      {(["costPrice", "sellingPrice"] as const).map((key) => (
                        <td key={key} className="px-2 py-1.5">
                          <Controller
                            name={`${base}.${key}`}
                            control={control}
                            render={({ field, fieldState }) => (
                              <Input
                                {...field}
                                inputMode="decimal"
                                aria-label={key === "costPrice" ? "Cost" : "Selling price"}
                                aria-invalid={fieldState.invalid}
                                title={fieldState.error?.message}
                                className={cn(cellInput, "text-right tabular-nums", fieldState.invalid && "border-danger")}
                              />
                            )}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            units.remove(i);
                            onIdentifiersChanged();
                          }}
                          aria-label={`Remove ${normalizeIdentifier(unit.identifier)}`}
                          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          <X aria-hidden className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
