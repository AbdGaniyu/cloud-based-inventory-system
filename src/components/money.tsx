import { formatMoney, money, type MoneyInput } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Money with tabular numerals; negatives get a minus and Danger colour (DESIGN.md §2.6). */
export function Money({ value, className, tone }: { value: MoneyInput; className?: string; tone?: "danger" }) {
  const negative = money(value).isNegative();
  return (
    <span className={cn("tabular-nums whitespace-nowrap", (negative || tone === "danger") && "text-danger", className)}>
      {formatMoney(value)}
    </span>
  );
}

const ABBREVIATIONS: [number, string][] = [
  [1_000_000_000, "B"],
  [1_000_000, "M"],
  [1_000, "K"],
];

/** "₦12.4M" for KPI cards; pair with the full value in a title/tooltip. */
export function formatMoneyShort(value: MoneyInput, symbol: string): string {
  const amount = money(value);
  for (const [size, suffix] of ABBREVIATIONS) {
    if (amount.abs().gte(size)) return `${symbol}${amount.dividedBy(size).toDecimalPlaces(1).toString()}${suffix}`;
  }
  return formatMoney(amount);
}
