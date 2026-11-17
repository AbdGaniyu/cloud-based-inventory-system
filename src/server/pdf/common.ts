import "server-only";

import type { CustomerPaymentKind, InstallmentFrequency, PaymentMethod, ScheduleStatus } from "@/generated/prisma/enums";
import { STORE } from "@/config/store";
import { formatMoney } from "@/lib/money";
import type { DisplayInvoiceStatus } from "@/server/services/document.service";

/** Shared wording and formatting for printed documents (always light: black on white, DESIGN.md §6). */

export const MM = 2.835; // points per millimetre

export const money = (value: string) => formatMoney(value);

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: STORE.timezone });
const calendarFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: STORE.timezone });

/** An instant (ISO string) as a Lagos date: "14 Mar 2026". */
export const formatInstantDate = (iso: string) => dateFormat.format(new Date(iso));
export const formatInstantDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));
/** A calendar date ("2026-03-14") as "14 Mar 2026". */
export const formatCalendar = (date: string) => calendarFormat.format(new Date(`${date}T00:00:00Z`));

export const INVOICE_STATUS_WORDS: Record<DisplayInvoiceStatus, string> = {
  PAID: "Paid",
  PARTIALLY_PAID: "Partially paid",
  UNPAID: "Unpaid",
  OVERDUE: "Overdue",
  VOID: "Void",
  RETURNED: "Returned",
};

export const METHOD_WORDS: Record<PaymentMethod, string> = { CASH: "Cash", BANK_TRANSFER: "Bank transfer", POS_CARD: "POS card" };

export const PAYMENT_KIND_WORDS: Record<CustomerPaymentKind, string> = {
  CHECKOUT: "Payment at sale",
  DOWN_PAYMENT: "Down payment",
  INSTALLMENT: "Instalment",
  REFUND: "Refund",
};

export const SCHEDULE_WORDS: Record<ScheduleStatus | "CANCELLED", string> = {
  PENDING: "Pending",
  PARTIAL: "Part paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  WAIVED: "Waived",
  CANCELLED: "Cancelled",
};

export const FREQUENCY_WORDS: Record<InstallmentFrequency, string> = { WEEKLY: "weekly", BI_WEEKLY: "every two weeks", MONTHLY: "monthly" };
