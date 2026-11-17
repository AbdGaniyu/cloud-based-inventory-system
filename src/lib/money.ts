import Decimal from "decimal.js";

import { STORE } from "@/config/store";

/**
 * Money helpers. Money is never a JS float (invariant 1): values are decimal.js instances,
 * Prisma Decimal columns are written as fixed-2 strings, and rounding happens only where a
 * value is persisted or presented.
 */
const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;

/** Anything we accept as a money value: a decimal string, a safe integer, or a Decimal-like (incl. Prisma.Decimal). */
export type MoneyInput = string | number | Decimal | { toFixed(): string };

export function money(value: MoneyInput): Money {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`Refusing to build money from non-integer number ${value}; pass a decimal string`);
    }
    return new MoneyDecimal(value);
  }
  if (typeof value === "string") {
    return new MoneyDecimal(value.trim());
  }
  // Prisma returns its own bundled Decimal class; go through the exact string form.
  return new MoneyDecimal(value.toFixed());
}

export const ZERO: Money = new MoneyDecimal(0);

export function sum(values: Iterable<MoneyInput>): Money {
  let total = ZERO;
  for (const v of values) total = total.plus(money(v));
  return total;
}

/** Round half-up to 2 decimal places (kobo). */
export function round2(value: MoneyInput): Money {
  return money(value).toDecimalPlaces(STORE.currencyDecimals, Decimal.ROUND_HALF_UP);
}

/** Fixed 2-dp string for writing to a Decimal(14,2) column. */
export function toDb(value: MoneyInput): string {
  return round2(value).toFixed(STORE.currencyDecimals);
}

/** `percent`% of `amount`, rounded to kobo. percent is e.g. "7.5" for 7.5%. */
export function percentOf(amount: MoneyInput, percent: MoneyInput): Money {
  return round2(money(amount).times(money(percent)).dividedBy(100));
}

/**
 * Split `total` into `parts` instalments of 2-dp amounts. Every part but the last is rounded
 * down; the last absorbs the remainder, so the parts always sum exactly to `total`.
 */
export function splitEvenly(total: MoneyInput, parts: number): Money[] {
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new RangeError(`parts must be a positive integer, got ${parts}`);
  }
  const amount = round2(total);
  if (amount.lessThan(money("0.01").times(parts))) {
    throw new RangeError(`Cannot split ${amount.toFixed(2)} into ${parts} non-zero parts`);
  }
  const each = amount.dividedBy(parts).toDecimalPlaces(STORE.currencyDecimals, Decimal.ROUND_DOWN);
  const result = Array.from({ length: parts - 1 }, () => each);
  result.push(amount.minus(each.times(parts - 1)));
  return result;
}

const currencyFormatter = new Intl.NumberFormat(STORE.currencyLocale, {
  style: "currency",
  currency: STORE.currency,
  minimumFractionDigits: STORE.currencyDecimals,
  maximumFractionDigits: STORE.currencyDecimals,
});

const plainFormatter = new Intl.NumberFormat(STORE.currencyLocale, {
  minimumFractionDigits: STORE.currencyDecimals,
  maximumFractionDigits: STORE.currencyDecimals,
});

/** "₦1,350,000.00". Formats from the exact decimal string, never via a float. */
export function formatMoney(value: MoneyInput, options: { symbol?: boolean } = {}): string {
  const exact = round2(value).toFixed(STORE.currencyDecimals) as Intl.StringNumericLiteral;
  return options.symbol === false ? plainFormatter.format(exact) : currencyFormatter.format(exact);
}

const compactFormatter = new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 });

/** "₦13.3M" for headline figures; pair with the exact value in a title or tooltip. */
export function formatMoneyCompact(value: MoneyInput): string {
  const exact = round2(value);
  const sign = exact.lt(0) ? "−" : "";
  return `${sign}${STORE.currencySymbol}${compactFormatter.format(exact.abs().toFixed(2) as Intl.StringNumericLiteral)}`;
}
