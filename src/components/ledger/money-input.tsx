import { Input } from "@/components/ui/input";
import { STORE } from "@/config/store";
import { cn } from "@/lib/utils";

/** Amount field with the naira sign inside, right-aligned tabular figures. */
export function MoneyInput({ className, ...props }: Omit<React.ComponentProps<typeof Input>, "inputMode">) {
  return (
    <span className="relative block">
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
        {STORE.currencySymbol}
      </span>
      <Input inputMode="decimal" autoComplete="off" className={cn("pl-7 text-right tabular-nums", className)} {...props} />
    </span>
  );
}
