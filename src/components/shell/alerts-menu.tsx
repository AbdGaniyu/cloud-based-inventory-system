"use client";

import { AlertTriangle, Bell, Clock, HandCoins, MessageSquareX, PackageMinus, Repeat, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AlertBreakdown } from "@/server/services/shell.service";

type Row = { key: string; label: string; count: number; href: string; icon: typeof Bell; tone: "danger" | "warning" };

/** Alerts button: overdue accounts, low stock, aging units, overdue supplier bills and failed messages. */
export function AlertsMenu({ alerts }: { alerts: AlertBreakdown }) {
  const [open, setOpen] = useState(false);
  const rows: Row[] = [
    { key: "overdue", label: "Overdue customer accounts", count: alerts.overdueAccounts, href: "/ledger/receivables", icon: HandCoins, tone: "danger" },
    { key: "low", label: "Accessories at or below reorder level", count: alerts.lowStock, href: "/inventory?tab=accessories&low=1", icon: PackageMinus, tone: "warning" },
    { key: "aging", label: "Devices in stock 60+ days", count: alerts.agingUnits, href: "/inventory?aging=1", icon: Clock, tone: "warning" },
    ...(alerts.overduePayables === null
      ? []
      : [{ key: "payables", label: "Overdue supplier bills", count: alerts.overduePayables, href: "/ledger/payables", icon: Wallet, tone: "danger" as const }]),
    { key: "failed", label: "Messages that failed to send", count: alerts.failedMessages, href: "/notifications", icon: MessageSquareX, tone: "danger" },
    ...(alerts.tradeInsPending === null
      ? []
      : [{ key: "tradeins", label: "Trade-ins waiting to be priced", count: alerts.tradeInsPending, href: "/inventory?status=TRADED_IN", icon: Repeat, tone: "warning" as const }]),
  ];
  const active = rows.filter((r) => r.count > 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex h-9 items-center gap-2 rounded-lg bg-secondary px-3 text-body font-medium text-foreground transition-colors duration-150 hover:bg-secondary-hover"
        aria-label={`Alerts: ${alerts.total}`}
      >
        <Bell aria-hidden className="size-4" />
        <span className="max-lg:hidden">Alerts</span>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-[11px] font-semibold tabular-nums">
          {alerts.total}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0 shadow-popover">
        <div className="border-b border-border px-4 py-3">
          <p className="text-h3">Alerts</p>
          <p className="text-small text-muted-foreground">For the branches you are viewing.</p>
        </div>
        {active.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-6 text-body text-muted-foreground">
            <AlertTriangle aria-hidden className="size-4" /> Nothing needs attention.
          </p>
        ) : (
          <ul className="py-1">
            {active.map((row) => {
              const Icon = row.icon;
              return (
                <li key={row.key}>
                  <Link
                    href={row.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center gap-3 px-4 py-2 text-body hover:bg-secondary"
                  >
                    <Icon aria-hidden className={cn("size-4", row.tone === "danger" ? "text-danger" : "text-warning")} />
                    <span className="flex-1">{row.label}</span>
                    <span
                      className={cn(
                        "rounded-full border px-2 text-caption tabular-nums",
                        row.tone === "danger"
                          ? "border-danger-border bg-danger-bg text-danger"
                          : "border-warning-border bg-warning-bg text-warning",
                      )}
                    >
                      {row.count}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
