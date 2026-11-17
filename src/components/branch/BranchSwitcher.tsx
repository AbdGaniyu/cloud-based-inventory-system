"use client";

import { Check, ChevronsUpDown, Globe, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setActiveBranch } from "@/app/(app)/branch-actions";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BranchType } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export type SwitcherBranch = { id: string; name: string; code: string; type: BranchType };

const ALL = "ALL";
// Branch identity dots reuse the chart palette tokens so no new colours are introduced.
const DOT_CLASSES = ["bg-chart-1", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-2"];

/** Same colour for a branch everywhere, whoever is looking. */
function dotClass(code: string): string {
  let hash = 0;
  for (const ch of code) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return DOT_CLASSES[hash % DOT_CLASSES.length];
}

function BranchLabel({ branch }: { branch: SwitcherBranch }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dotClass(branch.code))} />
      <span className="truncate">{branch.name}</span>
      <span className="font-mono text-caption text-subtle-foreground">{branch.code}</span>
    </span>
  );
}

/**
 * Owners: combobox with "All branches" + every branch. Managers and cashiers: a static chip
 * with a lock — their scope is fixed server-side regardless of anything the client sends.
 */
export function BranchSwitcher({
  branches,
  activeBranchId,
  canSwitch,
}: {
  branches: SwitcherBranch[];
  activeBranchId: string | null;
  canSwitch: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = branches.find((b) => b.id === activeBranchId) ?? null;

  if (!canSwitch) {
    const home = branches[0];
    return (
      <div
        className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-body"
        aria-label={home ? `Branch: ${home.name} (fixed)` : "No branch assigned"}
      >
        {home ? <BranchLabel branch={home} /> : <span>No branch</span>}
        <Lock aria-hidden className="size-3.5 text-subtle-foreground" />
      </div>
    );
  }

  function choose(branchId: string) {
    setOpen(false);
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Switch branch"
          disabled={pending}
          className="w-64 justify-between font-normal"
        >
          {active ? (
            <BranchLabel branch={active} />
          ) : (
            <span className="flex items-center gap-2">
              <Globe aria-hidden className="size-4 text-info" />
              All branches
            </span>
          )}
          <ChevronsUpDown aria-hidden className="size-4 text-subtle-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0 shadow-popover" align="start">
        <Command>
          <CommandInput placeholder="Find branch…" />
          <CommandList>
            <CommandEmpty>No branch found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="all branches" onSelect={() => choose(ALL)}>
                <Globe aria-hidden className="size-4 text-info" />
                All branches
                <Check aria-hidden className={cn("ml-auto size-4", active ? "opacity-0" : "opacity-100")} />
              </CommandItem>
              {branches.map((branch) => (
                <CommandItem key={branch.id} value={`${branch.name} ${branch.code}`} onSelect={() => choose(branch.id)}>
                  <BranchLabel branch={branch} />
                  <Check
                    aria-hidden
                    className={cn("ml-auto size-4", branch.id === activeBranchId ? "opacity-100" : "opacity-0")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
