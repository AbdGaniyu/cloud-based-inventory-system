import { z } from "zod";

import { TrackingType } from "@/generated/prisma/enums";
import { moneyString, optionalText } from "@/lib/validators/common";

export const productSchema = z.object({
  name: z.string().trim().min(2, "Enter the product name").max(120),
  brand: z.string().trim().min(1, "Enter the brand").max(60),
  category: z.string().trim().min(2, "Enter a category").max(40),
  trackingType: z.enum(TrackingType),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/, "3–40 letters, digits or dashes"),
  barcode: optionalText(40).refine((v) => v === undefined || /^[0-9A-Za-z-]{4,40}$/.test(v), "4–40 letters, digits or dashes"),
  defaultCostPrice: moneyString,
  defaultSellingPrice: moneyString,
  warrantyMonths: z.number().int().min(0, "0–60").max(60, "0–60"),
  reorderLevel: z.number().int().min(0, "0 or more").max(10_000),
  isActive: z.boolean(),
});

export type ProductInput = z.infer<typeof productSchema>;
export type ProductFormValues = z.input<typeof productSchema>;
