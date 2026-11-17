"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { saveProduct } from "@/app/(app)/inventory/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { STORE } from "@/config/store";
import { useUrlParams } from "@/hooks/use-url-params";
import { type ProductFormValues, type ProductInput, productSchema } from "@/lib/validators/product";

const EMPTY: ProductFormValues = {
  name: "",
  brand: "",
  category: "",
  trackingType: "SERIALIZED",
  sku: "",
  barcode: "",
  defaultCostPrice: "",
  defaultSellingPrice: "",
  warrantyMonths: 12,
  reorderLevel: 0,
  isActive: true,
};

type TextField = "name" | "brand" | "category" | "sku" | "barcode";

/** Owner-only create / edit product sheet (side sheet, not a modal — DESIGN.md §9). */
export function ProductSheet({
  open,
  product,
  categories,
}: {
  open: boolean;
  product: (ProductInput & { id: string }) | null;
  categories: string[];
}) {
  const router = useRouter();
  const { setParams } = useUrlParams();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ProductFormValues, unknown, ProductInput>({
    resolver: zodResolver(productSchema),
    values: product ? { ...product, barcode: product.barcode ?? "" } : EMPTY,
  });
  const close = () => setParams({ edit: null }, { keepPage: true });

  async function onSubmit(values: ProductInput) {
    setFormError(null);
    const result = await saveProduct({ id: product?.id, product: values });
    if (!result.ok) {
      setFormError(result.error);
      for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(name as keyof ProductFormValues, { message: messages[0] });
      }
      return;
    }
    toast.success(product ? "Product updated" : "Product created");
    close();
    router.refresh();
  }

  const text = (name: TextField, label: string, opts: { placeholder?: string; mono?: boolean; list?: string } = {}) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`product-${name}`}>{label}</FieldLabel>
          <Input
            {...field}
            value={field.value ?? ""}
            id={`product-${name}`}
            placeholder={opts.placeholder}
            list={opts.list}
            className={opts.mono ? "font-mono" : undefined}
            aria-invalid={fieldState.invalid}
            aria-describedby={fieldState.error ? `product-${name}-error` : undefined}
          />
          {fieldState.error && <FieldError id={`product-${name}-error`} errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );

  const moneyField = (name: "defaultCostPrice" | "defaultSellingPrice", label: string, description?: string) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`product-${name}`}>{label}</FieldLabel>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
              {STORE.currencySymbol}
            </span>
            <Input
              {...field}
              id={`product-${name}`}
              inputMode="decimal"
              className="pl-7 text-right tabular-nums"
              aria-invalid={fieldState.invalid}
            />
          </div>
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );

  const intField = (name: "warrantyMonths" | "reorderLevel", label: string, description: string) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`product-${name}`}>{label}</FieldLabel>
          <Input
            id={`product-${name}`}
            type="number"
            min={0}
            inputMode="numeric"
            value={Number.isFinite(field.value) ? String(field.value) : ""}
            onChange={(event) => field.onChange(event.target.value === "" ? Number.NaN : event.target.valueAsNumber)}
            onBlur={field.onBlur}
            className="text-right tabular-nums"
            aria-invalid={fieldState.invalid}
          />
          <FieldDescription>{description}</FieldDescription>
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );

  return (
    <Sheet open={open} onOpenChange={(value) => !value && close()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[480px]">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-full flex-col">
          <SheetHeader className="border-b border-border p-6">
            <SheetTitle className="text-h2">{product ? "Edit product" : "New product"}</SheetTitle>
            <SheetDescription>Prices and costs are visible to the owner only.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-5 p-6">
            {formError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            {text("name", "Name", { placeholder: "Apple iPhone 15 Pro 256GB" })}
            <div className="grid grid-cols-2 gap-4">
              {text("brand", "Brand", { placeholder: "Apple" })}
              {text("category", "Category", { placeholder: "Phones", list: "product-categories" })}
              <datalist id="product-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <Controller
              name="trackingType"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="product-trackingType">Tracked by</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="product-trackingType" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SERIALIZED">IMEI / serial — one record per device</SelectItem>
                      <SelectItem value="NON_SERIALIZED">Quantity — accessories counted per branch</SelectItem>
                    </SelectContent>
                  </Select>
                  {fieldState.error && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              {text("sku", "SKU", { placeholder: "PH-APL-IP15P-256", mono: true })}
              {text("barcode", "Barcode (optional)", { mono: true })}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {moneyField("defaultSellingPrice", "Selling price")}
              {moneyField("defaultCostPrice", "Default cost", "Updated by each accessory intake")}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {intField("warrantyMonths", "Warranty (months)", "0 for no warranty")}
              {intField("reorderLevel", "Reorder level", "Low-stock alert at or below; 0 = off")}
            </div>
            <Controller
              name="isActive"
              control={form.control}
              render={({ field }) => (
                <label className="flex min-h-11 items-center gap-3 text-body">
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(event) => field.onChange(event.target.checked)}
                    className="size-4 accent-primary"
                  />
                  Active — can be received and sold
                </label>
              )}
            />
          </div>
          <SheetFooter className="border-t border-border p-6">
            <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
              {form.formState.isSubmitting && <Loader2 aria-hidden className="animate-spin" />}
              {product ? "Save changes" : "Create product"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
