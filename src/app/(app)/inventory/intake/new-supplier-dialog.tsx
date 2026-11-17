"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { addSupplier } from "@/app/(app)/inventory/intake/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type QuickSupplierFormValues, type QuickSupplierInput, quickSupplierSchema } from "@/lib/validators/supplier";

/** Short form, so a dialog is fine here (long forms use pages or sheets — DESIGN.md §9). */
export function NewSupplierDialog({ onCreated }: { onCreated: (supplier: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<QuickSupplierFormValues, unknown, QuickSupplierInput>({
    resolver: zodResolver(quickSupplierSchema),
    defaultValues: { name: "", phone: "", contactPerson: "" },
  });

  async function onSubmit(values: QuickSupplierInput) {
    setError(null);
    const result = await addSupplier(values);
    if (!result.ok) {
      setError(result.error);
      for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(name as keyof QuickSupplierFormValues, { message: messages[0] });
      }
      return;
    }
    onCreated(result.data);
    form.reset();
    setOpen(false);
  }

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          <Plus aria-hidden data-icon="inline-start" /> New supplier
        </Button>
      </DialogTrigger>
      <DialogContent className="shadow-dialog sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New supplier</DialogTitle>
          <DialogDescription>Add the supplier now; credit terms are set on each intake.</DialogDescription>
        </DialogHeader>
        {/* Separate form element: this dialog sits outside the intake form in the DOM via a portal. */}
        <form
          onSubmit={(event) => {
            event.stopPropagation();
            void form.handleSubmit(onSubmit)(event);
          }}
          noValidate
          className="flex flex-col gap-4"
        >
          {error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-small text-danger">{error}</p>}
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="supplier-name">Name</FieldLabel>
            <Input id="supplier-name" autoFocus aria-invalid={Boolean(errors.name)} {...form.register("name")} />
            {errors.name && <FieldError errors={[errors.name]} />}
          </Field>
          <Field data-invalid={Boolean(errors.phone)}>
            <FieldLabel htmlFor="supplier-phone">Phone (optional)</FieldLabel>
            <Input id="supplier-phone" type="tel" placeholder="0803 123 4567" aria-invalid={Boolean(errors.phone)} {...form.register("phone")} />
            {errors.phone && <FieldError errors={[errors.phone]} />}
          </Field>
          <Field>
            <FieldLabel htmlFor="supplier-contact">Contact person (optional)</FieldLabel>
            <Input id="supplier-contact" {...form.register("contactPerson")} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 aria-hidden className="animate-spin" />}
              Add supplier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
