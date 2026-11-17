"use client";

import { Trash2 } from "lucide-react";
import { type Control, Controller, useWatch } from "react-hook-form";

import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STORE } from "@/config/store";
import { cn } from "@/lib/utils";
import type { IntakeFormValues } from "@/lib/validators/intake";
import type { IntakeProductOption } from "@/server/services/intake.service";

function MoneyInput({
  id,
  label,
  value,
  onChange,
  onBlur,
  invalid,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  invalid: boolean;
  error?: string;
}) {
  return (
    <div className="w-40">
      <label htmlFor={id} className="mb-1.5 block text-small font-medium">
        {label}
      </label>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
          {STORE.currencySymbol}
        </span>
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          inputMode="decimal"
          aria-invalid={invalid}
          className={cn("pl-7 text-right tabular-nums", invalid && "border-danger")}
        />
      </div>
      {error && <p className="mt-1 text-small text-danger">{error}</p>}
    </div>
  );
}

/** Accessory line: quantity, unit cost and (owner only) selling price. */
export function AccessoryLine({
  index,
  control,
  products,
  canEditPrices,
  onRemove,
}: {
  index: number;
  control: Control<IntakeFormValues>;
  products: IntakeProductOption[];
  canEditPrices: boolean;
  onRemove: () => void;
}) {
  const productId = useWatch({ control, name: `accessoryLines.${index}.productId` });
  const product = products.find((p) => p.id === productId);
  const base = `accessoryLines.${index}` as const;

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-border p-4">
      <Controller
        name={`${base}.productId`}
        control={control}
        render={({ field, fieldState }) => (
          <div className="min-w-64 flex-1">
            <label htmlFor={`acc-${index}-product`} className="mb-1.5 block text-small font-medium">
              Accessory
            </label>
            <Select value={field.value || undefined} onValueChange={field.onChange}>
              <SelectTrigger id={`acc-${index}-product`} className="w-full" aria-invalid={fieldState.invalid}>
                <SelectValue placeholder="Choose an accessory" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} <span className="font-mono text-muted-foreground">· {p.sku}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldState.error && <p className="mt-1 text-small text-danger">Choose an accessory</p>}
          </div>
        )}
      />
      <Controller
        name={`${base}.quantity`}
        control={control}
        render={({ field, fieldState }) => (
          <div className="w-28">
            <label htmlFor={`acc-${index}-qty`} className="mb-1.5 block text-small font-medium">
              Quantity
            </label>
            <Input
              id={`acc-${index}-qty`}
              type="number"
              min={1}
              inputMode="numeric"
              value={Number.isFinite(field.value) ? String(field.value) : ""}
              onChange={(event) => field.onChange(event.target.value === "" ? Number.NaN : event.target.valueAsNumber)}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid}
              className={cn("text-right tabular-nums", fieldState.invalid && "border-danger")}
            />
            {fieldState.error && <p className="mt-1 text-small text-danger">{fieldState.error.message}</p>}
          </div>
        )}
      />
      <Controller
        name={`${base}.unitCost`}
        control={control}
        render={({ field, fieldState }) => (
          <MoneyInput
            id={`acc-${index}-cost`}
            label="Unit cost"
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            invalid={fieldState.invalid}
            error={fieldState.error?.message}
          />
        )}
      />
      {canEditPrices ? (
        <Controller
          name={`${base}.unitSellingPrice`}
          control={control}
          render={({ field, fieldState }) => (
            <MoneyInput
              id={`acc-${index}-price`}
              label="Selling price"
              value={field.value ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              invalid={fieldState.invalid}
              error={fieldState.error?.message}
            />
          )}
        />
      ) : (
        <div className="w-40">
          <p className="mb-1.5 text-small font-medium">Selling price</p>
          <p className="flex h-9 items-center justify-end text-body">
            {product ? <Money value={product.defaultSellingPrice} /> : "—"}
          </p>
        </div>
      )}
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Remove this accessory line" className="mt-6">
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}
