import { formatMoney, type MoneyInput, money } from "@/lib/money";

/**
 * Installment plans above the approval threshold, or with a down payment below the minimum
 * percentage of the invoice total, need a manager's (or the owner's) approval (CLAUDE.md §7.4).
 * Shared by the POS screen (to label the button) and checkout (to enforce it).
 */
export function installmentApproval(input: {
  total: MoneyInput;
  downPayment: MoneyInput;
  threshold: MoneyInput;
  minDownPaymentPercent: MoneyInput;
}): { required: boolean; reasons: string[] } {
  const total = money(input.total);
  const down = money(input.downPayment);
  const financed = total.minus(down);
  const reasons: string[] = [];
  if (financed.gt(money(input.threshold))) {
    reasons.push(`Financed amount is above ${formatMoney(input.threshold)}`);
  }
  const minimumDown = total.times(money(input.minDownPaymentPercent)).dividedBy(100);
  if (down.lt(minimumDown)) {
    reasons.push(`Down payment is below ${money(input.minDownPaymentPercent).toString()}% of the total`);
  }
  return { required: reasons.length > 0, reasons };
}
