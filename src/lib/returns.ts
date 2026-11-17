import { money, type Money, type MoneyInput, round2, ZERO } from "@/lib/money";

/**
 * Credit for returned goods (CLAUDE.md §7.6). A line is worth its share of the invoice total, so
 * the invoice discount, VAT and any trade-in credit are spread across lines in proportion: a
 * refund never exceeds what was charged, and a traded-in device stays with the store.
 */

/** Full credit value per invoice line, in line order; the last line takes the rounding so the values sum to the total. */
export function lineCreditValues(invoice: { subtotal: MoneyInput; total: MoneyInput; lines: { invoiceItemId: string; lineTotal: MoneyInput }[] }): Map<string, Money> {
  const subtotal = money(invoice.subtotal);
  const total = money(invoice.total);
  const values = new Map<string, Money>();
  let allocated = ZERO;
  invoice.lines.forEach((line, index) => {
    const last = index === invoice.lines.length - 1;
    const value = subtotal.lte(0) ? ZERO : last ? total.minus(allocated) : round2(total.times(money(line.lineTotal)).div(subtotal));
    values.set(line.invoiceItemId, value);
    allocated = allocated.plus(value);
  });
  return values;
}

/**
 * Credit for returning `quantity` more units of a line worth `lineValue` for `lineQuantity` units,
 * `alreadyReturned` of which came back earlier. Cumulative rounding: every unit returned adds up to the line value.
 */
export function returnCredit(lineValue: MoneyInput, lineQuantity: number, alreadyReturned: number, quantity: number): Money {
  if (quantity < 1 || alreadyReturned < 0 || alreadyReturned + quantity > lineQuantity) {
    throw new RangeError("Cannot return more than was sold");
  }
  const value = money(lineValue);
  const upTo = (n: number) => (n === lineQuantity ? value : round2(value.times(n).div(lineQuantity)));
  return upTo(alreadyReturned + quantity).minus(upTo(alreadyReturned));
}
