"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setActiveBranch } from "@/app/(app)/branch-actions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BranchType } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export type SwitcherBranch = {
  id: string;
  name: string;
  code: string;
  type: BranchType;
  colorIndex: number;
  shortLabel: string;
};

const ALL = "ALL";
const BRANCH_BG = ["bg-branch-1", "bg-branch-2", "bg-branch-3", "bg-branch-4", "bg-branch-5", "bg-branch-6"];

export function branchColorClass(colorIndex: number): string {
  return BRANCH_BG[colorIndex % BRANCH_BG.length];
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-background bg-badge px-1 text-[10px] font-semibold leading-none text-badge-foreground tabular-nums"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function Tile({
  label,
  colorClass,
  active,
  count,
  name,
  onSelect,
  disabled,
  locked,
}: {
  label: string;
  colorClass: string;
  active: boolean;
  count: number;
  name: string;
  onSelect?: () => void;
  disabled?: boolean;
  locked?: boolean;
}) {
  const accessibleName = `${name}${count > 0 ? ` — ${count} alert${count === 1 ? "" : "s"}` : ""}${locked ? " (your branch)" : ""}`;
  const tile = (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={locked ? undefined : active}
      aria-current={active ? "true" : undefined}
      aria-label={accessibleName}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-lg text-[12px] font-bold tracking-wide text-white transition-shadow duration-150",
        colorClass,
        active && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
        locked ? "cursor-default" : "hover:ring-2 hover:ring-border-strong hover:ring-offset-2 hover:ring-offset-background",
        active && !locked && "hover:ring-foreground",
        disabled && "opacity-60",
      )}
    >
      {label}
      <CountBadge count={count} />
    </button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-1.5">
        {locked && <Lock aria-hidden className="size-3" />}
        {locked ? `${name} — your branch` : name}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Branch rail tiles. Owners pick "All branches" or one branch; managers and cashiers see only
 * their own tile, which is not interactive — their scope is fixed server-side.
 */
export function BranchSwitcher({
  branches,
  activeBranchId,
  canSwitch,
  branchAlerts,
}: {
  branches: SwitcherBranch[];
  activeBranchId: string | null;
  canSwitch: boolean;
  branchAlerts: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(branchId: string) {
    if (branchId === (activeBranchId ?? ALL)) return;
    startTransition(async () => {
      const result = await setActiveBranch({ branchId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (!canSwitch) {
    return (
      <nav aria-label="Branch" className="flex flex-col items-center gap-3">
        {branches.map((b) => (
          <Tile
            key={b.id}
            label={b.shortLabel}
            colorClass={branchColorClass(b.colorIndex)}
            active
            locked
            count={branchAlerts[b.id] ?? 0}
            name={`${b.name} (${b.code})`}
          />
        ))}
      </nav>
    );
  }

  const allCount = branches.reduce((n, b) => n + (branchAlerts[b.id] ?? 0), 0);
  return (
    <nav aria-label="Switch branch" className="flex flex-col items-center gap-3" aria-busy={pending}>
      <Tile
        label="ALL"
        colorClass="bg-primary text-primary-foreground"
        active={activeBranchId === null}
        count={allCount}
        name="All branches"
        onSelect={() => choose(ALL)}
        disabled={pending}
      />
      {branches.map((b) => (
        <Tile
          key={b.id}
          label={b.shortLabel}
          colorClass={branchColorClass(b.colorIndex)}
          active={activeBranchId === b.id}
          count={branchAlerts[b.id] ?? 0}
          name={`${b.name} (${b.code})`}
          onSelect={() => choose(b.id)}
          disabled={pending}
        />
      ))}
    </nav>
  );
}
