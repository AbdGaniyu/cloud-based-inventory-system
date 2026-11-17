import { type Money, type MoneyInput, money, percentOf, round2, sum, ZERO } from "@/lib/money";

/**
 * Invoice arithmetic shared by checkout, the POS preview and the seed. Mirrors the CHECK
 * constraints on invoices / invoice_items:
 *   lineTotal = quantity × unitPrice − lineDiscount
 *   subtotal  = Σ lineTotal
 *   taxAmount = round2((subtotal − discount) × taxRate / 100)
 *   total     = subtotal − discount + taxAmount − tradeInCredit
 */
export type InvoiceLineInput = {
  quantity: number;
  unitPrice: MoneyInput;
  discount?: MoneyInput;
};

export type InvoiceTotals = {
  lineTotals: Money[];
  subtotal: Money;
  discount: Money;
  taxRatePercent: Money;
  taxAmount: Money;
  tradeInCredit: Money;
  total: Money;
};

export function computeInvoiceTotals(input: {
  lines: InvoiceLineInput[];
  discount?: MoneyInput;
  taxRatePercent: MoneyInput;
  tradeInCredit?: MoneyInput;
}): InvoiceTotals {
  if (input.lines.length === 0) throw new RangeError("An invoice needs at least one line");

  const lineTotals = input.lines.map((line, i) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(`Line ${i + 1}: quantity must be a positive integer`);
    }
    const gross = round2(money(line.unitPrice).times(line.quantity));
    const lineDiscount = round2(line.discount ?? ZERO);
    if (lineDiscount.isNegative() || lineDiscount.greaterThan(gross)) {
      throw new RangeError(`Line ${i + 1}: discount must be between 0 and the line amount`);
    }
    return gross.minus(lineDiscount);
  });

  const subtotal = sum(lineTotals);
  const discount = round2(input.discount ?? ZERO);
  if (discount.isNegative() || discount.greaterThan(subtotal)) {
    throw new RangeError("Invoice discount must be between 0 and the subtotal");
  }

  const taxRatePercent = money(input.taxRatePercent);
  if (taxRatePercent.isNegative()) throw new RangeError("Tax rate cannot be negative");
  const taxAmount = percentOf(subtotal.minus(discount), taxRatePercent);

  const tradeInCredit = round2(input.tradeInCredit ?? ZERO);
  const beforeTradeIn = subtotal.minus(discount).plus(taxAmount);
  if (tradeInCredit.isNegative() || tradeInCredit.greaterThan(beforeTradeIn)) {
    throw new RangeError("Trade-in credit must be between 0 and the invoice amount");
  }

  return {
    lineTotals,
    subtotal,
    discount,
    taxRatePercent,
    taxAmount,
    tradeInCredit,
    total: beforeTradeIn.minus(tradeInCredit),
  };
}
