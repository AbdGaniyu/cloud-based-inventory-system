"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setActiveBranch } from "@/app/(app)/branch-actions";
import { branchColorClass } from "@/components/branch/BranchSwitcher";
import { Money } from "@/components/money";
import { PaidGauge } from "@/components/paid-gauge";
import { Badge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { BranchPerformance } from "@/server/services/dashboard.service";

function Figure({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("text-right", className)}>
      <p className="text-small text-muted-foreground">{label}</p>
      <p className="text-body font-medium tabular-nums">{children}</p>
    </div>
  );
}

/** One row per branch (mockup: Branch performance); the row opens the dashboard scoped to it. */
export function BranchPerformanceList({ branches }: { branches: BranchPerformance[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function open(branch: BranchPerformance) {
    startTransition(async () => {
      const result = await setActiveBranch({ branchId: branch.id });
      if (!result.ok) return void toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="Branch performance">
      {branches.map((b) => (
        <li key={b.id}>
          <button
            type="button"
            disabled={pending}
            onClick={() => open(b)}
            aria-label={`Show ${b.name} on its own`}
            className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-60 lg:grid-cols-[auto_minmax(140px,1fr)_minmax(150px,auto)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_96px_auto]"
          >
            <span aria-hidden className={cn("flex size-12 items-center justify-center rounded-lg text-small font-semibold text-white", branchColorClass(b.colorIndex))}>
              {b.code}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-body font-medium">{b.name}</span>
              <span className="block text-small text-muted-foreground">{b.type === "WAREHOUSE" ? "Warehouse" : `${b.unitsSold} unit${b.unitsSold === 1 ? "" : "s"} sold`}</span>
            </span>
            <span className="hidden items-center gap-3 lg:flex">
              <span>
                <span className="block text-small text-muted-foreground">Collection</span>
                <span className="block text-body font-medium tabular-nums">{b.collectionRate === null ? "—" : `${b.collectionRate}%`}</span>
              </span>
              {b.collectionRate !== null && <PaidGauge percent={b.collectionRate} className="h-8 w-14 shrink-0" />}
            </span>
            <Figure label="Invoiced" className="hidden lg:block">
              <Money value={b.invoiced} />
            </Figure>
            <Figure label="Receivables" className="hidden lg:block">
              <Money value={b.receivables} />
            </Figure>
            <Figure label="Stock value" className="hidden lg:block">
              <Money value={b.stockValue} />
            </Figure>
            <span className="hidden lg:block">
              <span className="block text-small text-muted-foreground">Low stock</span>
              {b.lowStock > 0 ? <Badge tone="warning" dot={false}>{b.lowStock} item{b.lowStock === 1 ? "" : "s"}</Badge> : <Badge tone="neutral" dot={false}>None</Badge>}
            </span>
            <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            <span className="col-span-3 flex flex-wrap gap-x-4 text-small text-muted-foreground lg:hidden">
              <span>Invoiced <Money value={b.invoiced} className="text-foreground" /></span>
              <span>Receivables <Money value={b.receivables} className="text-foreground" /></span>
              <span>Low stock {b.lowStock}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
