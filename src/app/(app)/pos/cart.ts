import type { InstallmentFrequency, PaymentMethod, UnitCondition } from "@/generated/prisma/enums";
import { computeInvoiceTotals, type InvoiceTotals } from "@/lib/invoice-totals";
import { type Money, money, ZERO } from "@/lib/money";
import type { TradeInInput } from "@/lib/validators/checkout";

/** Client-side cart model for the POS. The server recomputes every figure from the database at checkout. */

export type CartUnit = {
  kind: "unit";
  key: string;
  unitId: string;
  productId: string;
  name: string;
  spec: string;
  identifier: string;
  condition: UnitCondition;
  price: string;
  discount: string;
};

export type CartAccessory = {
  kind: "accessory";
  key: string;
  productId: string;
  name: string;
  sku: string;
  price: string;
  quantity: number;
  available: number;
  discount: string;
};

export type CartLine = CartUnit | CartAccessory;

export type PaymentRow = { key: string; method: PaymentMethod; amount: string; reference: string };

export type PlanDraft = {
  numberOfInstallments: number;
  frequency: InstallmentFrequency;
  firstDueDate: string;
  guarantorName: string;
  guarantorPhone: string;
  idVerificationNotes: string;
};

export const METHOD_LABELS: Record<PaymentMethod, string> = { CASH: "Cash", BANK_TRANSFER: "Transfer", POS_CARD: "POS card" };

const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** Lenient parse for live previews: blank or half-typed amounts count as zero. */
export function moneyOrZero(value: string | undefined): Money {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  return MONEY_PATTERN.test(cleaned) ? money(cleaned) : ZERO;
}

export function isMoneyText(value: string): boolean {
  return MONEY_PATTERN.test(value.replace(/,/g, "").trim());
}

/** Live totals; returns the validation message instead of throwing (e.g. a discount larger than its line). */
export function previewTotals(
  lines: CartLine[],
  discount: string,
  vatRatePercent: string,
  tradeIn: TradeInInput | null,
): { totals: InvoiceTotals; error: null } | { totals: null; error: string } {
  if (lines.length === 0) return { totals: null, error: "Add at least one item" };
  try {
    return {
      totals: computeInvoiceTotals({
        lines: lines.map((l) => ({
          quantity: l.kind === "unit" ? 1 : l.quantity,
          unitPrice: l.price,
          discount: moneyOrZero(l.discount),
        })),
        discount: moneyOrZero(discount),
        taxRatePercent: vatRatePercent,
        tradeInCredit: tradeIn ? moneyOrZero(tradeIn.creditAmount) : ZERO,
      }),
      error: null,
    };
  } catch (error) {
    return { totals: null, error: error instanceof Error ? error.message : "Check the cart" };
  }
}

let keyCounter = 0;
export const newKey = (prefix: string) => `${prefix}-${++keyCounter}`;
