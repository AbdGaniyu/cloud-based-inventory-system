"use client";

import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CheckoutResult } from "@/server/services/invoice.service";
import { formatCalendarDate } from "@/app/(app)/pos/payment-section";

/** Shown in place of the cart after checkout (mockup: pos-success). */
export function SuccessPanel({ result, onNewSale }: { result: CheckoutResult; onNewSale: () => void }) {
  const balanceDue = Number(result.balance) > 0;
  const comingSoon = "Printable documents arrive in build step 6";
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success-border bg-success-bg px-2.5 py-0.5 text-small font-medium text-success" role="status">
          <span aria-hidden className="size-1.5 rounded-full bg-success" /> Sale completed
        </span>
        <p className="mt-3 font-mono text-[26px] leading-8 tracking-tight">{result.number}</p>
        <p className="text-body text-muted-foreground">{result.customerName}</p>

        <dl className="mt-5 rounded-xl border border-border bg-background p-5 text-body">
          <div className="flex justify-between py-1">
            <dt className="text-muted-foreground">Total</dt>
            <dd>
              <Money value={result.total} className="font-medium" />
            </dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-muted-foreground">Amount paid</dt>
            <dd>
              <Money value={result.amountPaid} className="font-medium" />
            </dd>
          </div>
          <div className="mt-3 flex items-end justify-between border-t border-dashed border-border pt-4">
            <dt className="font-medium">Balance</dt>
            <dd>
              <Money value={result.balance} className="text-[36px] leading-10 font-bold" />
            </dd>
          </div>
          {balanceDue && result.nextDueDate && (
            <p className="mt-2 text-right text-small text-muted-foreground">First instalment due {formatCalendarDate(result.nextDueDate)}</p>
          )}
        </dl>

        <p className="mt-4">
          <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-small text-muted-foreground">
            Receipt · WhatsApp · switches on in build step 7
          </span>
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {["Print receipt", "Download invoice"].map((label) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button variant="secondary" size="lg" className="w-full" disabled>
                    {label}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{comingSoon}</TooltipContent>
            </Tooltip>
          ))}
          {result.warrantyCardIds.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="col-span-2">
                  <Button variant="secondary" size="lg" className="w-full" disabled>
                    View warranty card{result.warrantyCardIds.length > 1 ? "s" : ""}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{comingSoon}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="border-t border-border p-4">
        <Button size="lg" className="h-14 w-full rounded-xl text-[17px]" onClick={onNewSale} autoFocus>
          New sale
        </Button>
      </div>
    </div>
  );
}
