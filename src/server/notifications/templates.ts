import type { CalendarDate } from "@/lib/dates";
import { formatMoney, type MoneyInput } from "@/lib/money";

/** Template keys (CLAUDE.md §9) and the variables each may use. Bodies live in MessageTemplate rows. */
export const TEMPLATE_VARIABLES = {
  receipt: ["customer_name", "branch_name", "invoice_number", "invoice_total", "amount_paid", "balance_remaining", "document_link"],
  warranty_card: ["customer_name", "device_name", "serial_masked", "warranty_expiry", "warranty_link", "document_link"],
  installment_due_3d: ["customer_name", "amount_due", "due_date", "balance_remaining", "invoice_number", "branch_name", "payment_instructions"],
  installment_due_today: ["customer_name", "amount_due", "due_date", "balance_remaining", "invoice_number", "branch_name", "payment_instructions"],
  installment_overdue_1d: ["customer_name", "amount_due", "due_date", "balance_remaining", "invoice_number", "branch_name", "payment_instructions"],
  installment_overdue_7d: ["customer_name", "amount_due", "due_date", "balance_remaining", "invoice_number", "branch_name", "payment_instructions"],
  installment_overdue_14d: ["customer_name", "amount_due", "due_date", "balance_remaining", "invoice_number", "branch_name", "payment_instructions"],
  payment_confirmation: ["customer_name", "amount_paid", "invoice_number", "branch_name", "balance_remaining"],
  manual_reminder: ["customer_name", "branch_name", "invoice_number", "balance_remaining", "amount_due", "due_date", "payment_instructions"],
} as const;

export type TemplateKey = keyof typeof TEMPLATE_VARIABLES;
export type TemplateVariables = Record<string, string>;

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_VARIABLES) as TemplateKey[];

export function isTemplateKey(value: string): value is TemplateKey {
  return value in TEMPLATE_VARIABLES;
}

const VARIABLE = /\{\{\s*(\w+)\s*\}\}/g;

/** Fills {{variables}}; anything unknown renders as empty so a typo never leaks braces to a customer. */
export function renderTemplate(body: string, variables: TemplateVariables): string {
  return body
    .replace(VARIABLE, (_, name: string) => variables[name] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** The variables a body uses, in first-appearance order (WhatsApp/Twilio template parameters). */
export function variablesInOrder(body: string, variables: TemplateVariables): Record<string, string> {
  const ordered: Record<string, string> = {};
  for (const [, name] of body.matchAll(VARIABLE)) if (!(name in ordered)) ordered[name] = variables[name] ?? "";
  return ordered;
}

/** "NGN 1,343,750.00": the naira sign would force SMS into 70-character UCS-2 segments. */
export function messageMoney(value: MoneyInput): string {
  return `NGN ${formatMoney(value, { symbol: false })}`;
}

const calendar = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function messageDate(date: CalendarDate): string {
  return calendar.format(new Date(`${date}T00:00:00Z`));
}

/** Customers are greeted by first name. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  receipt: "Receipt",
  warranty_card: "Warranty card",
  installment_due_3d: "Due in 3 days",
  installment_due_today: "Due today",
  installment_overdue_1d: "1 day overdue",
  installment_overdue_7d: "7 days overdue",
  installment_overdue_14d: "14 days overdue",
  payment_confirmation: "Payment confirmation",
  manual_reminder: "Reminder",
};

export function templateLabel(key: string): string {
  return isTemplateKey(key) ? TEMPLATE_LABELS[key] : key;
}

/** Example values for the template editor's live preview. */
export const SAMPLE_VARIABLES: Record<string, string> = {
  customer_name: "Adaeze",
  branch_name: "Ikeja",
  invoice_number: "INV-IKJ-000123",
  invoice_total: "NGN 1,343,750.00",
  amount_paid: "NGN 300,000.00",
  balance_remaining: "NGN 943,750.00",
  amount_due: "NGN 207,291.66",
  due_date: "17 Dec 2026",
  device_name: "Samsung Galaxy S24 Ultra 256GB",
  serial_masked: "ending 3829",
  warranty_expiry: "16 Nov 2027",
  warranty_link: "https://gadgethub.example/w/XVAdeNkvlL",
  document_link: "https://gadgethub.example/api/pdf/invoice/…",
  payment_instructions: "Pay at any Gadget Hub branch or transfer to Zenith Bank 1012345678 (Gadget Hub Ltd).",
};
