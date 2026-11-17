import { z } from "zod";

import { moneyString, optionalText } from "@/lib/validators/common";

const percent = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percentage like 7.5")
  .refine((v) => Number(v) <= 100, "Must be 100 or less");

/** Settings → Business: tax, payments, approval and return rules, alerts, messaging retries. */
export const businessSettingsSchema = z.object({
  vatRatePercent: percent,
  approvalThreshold: moneyString,
  minDownPaymentPercent: percent,
  paymentInstructions: z.string().trim().min(10, "Tell customers how to pay").max(300),
  returnWindowDays: z.number().int().min(0).max(365),
  agingDays: z.number().int().min(7).max(365),
  maxAttempts: z.number().int().min(1).max(10),
  warrantyTerms: z.string().trim().min(10).max(1000),
});
export type BusinessSettingsInput = z.infer<typeof businessSettingsSchema>;

const branchFields = {
  name: z.string().trim().min(2, "Enter the branch name").max(80),
  type: z.enum(["STORE", "WAREHOUSE"]),
  address: z.string().trim().min(5, "Enter the address").max(200),
  phone: z.string().trim().min(7, "Enter a phone number").max(30),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional(),
};

export const createBranchSchema = z.object({
  ...branchFields,
  /** Printed in every document number (INV-IKJ-000123); fixed once created. */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/, "2–5 letters, e.g. IKJ"),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = z.object({ id: z.guid(), ...branchFields, isActive: z.boolean() });
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export const PASSWORD_MIN = 10;
const password = z.string().min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`).max(200);

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the person's name").max(80),
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
  role: z.enum(["OWNER", "BRANCH_MANAGER", "CASHIER"]),
  branchId: z.guid().optional(),
  password,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  id: z.guid(),
  name: z.string().trim().min(2).max(80),
  role: z.enum(["OWNER", "BRANCH_MANAGER", "CASHIER"]),
  branchId: z.guid().optional(),
  isActive: z.boolean(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ id: z.guid(), password });

export const updateTemplateSchema = z.object({
  key: z.string().max(60),
  body: z.string().trim().min(10, "The message is too short").max(1024),
  smsBody: optionalText(480),
  whatsappTemplateName: optionalText(120),
  whatsappTemplateLanguage: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Language code like en or en_US"),
  isActive: z.boolean(),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const providerChoiceSchema = z.object({
  whatsapp: z.enum(["whatsapp-cloud", "twilio", "console"]),
  sms: z.enum(["termii", "twilio", "console"]),
});

export const providerSecretSchema = z.object({ name: z.string().max(60), value: z.string().trim().min(1, "Paste the value").max(2000) });

export const testMessageSchema = z.object({ channel: z.enum(["WHATSAPP", "SMS"]), phone: z.string().trim().min(7).max(30) });
