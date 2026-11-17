import { Bell, Globe } from "lucide-react";
import Link from "next/link";

import { BranchSwitcher, type SwitcherBranch } from "@/components/branch/BranchSwitcher";
import { CommandMenu } from "@/components/shell/command-menu";
import type { NavGroup } from "@/components/shell/nav-config";
import { UserMenu } from "@/components/shell/user-menu";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function TopBar(props: {
  nav: NavGroup[];
  branches: SwitcherBranch[];
  activeBranchId: string | null;
  canSwitch: boolean;
  user: { name: string; email: string; roleLabel: string; branchLabel: string };
}) {
  const allBranches = props.canSwitch && props.activeBranchId === null;
  return (
    <div className="sticky top-0 z-20 bg-background">
      <header className="flex h-14 items-center gap-3 border-b border-border px-4 lg:px-6">
        <SidebarTrigger aria-label="Toggle sidebar" />
        <BranchSwitcher branches={props.branches} activeBranchId={props.activeBranchId} canSwitch={props.canSwitch} />
        <div className="ml-auto flex items-center gap-2">
          <CommandMenu nav={props.nav} />
          <Button variant="ghost" size="icon" asChild>
            <Link href="/notifications" aria-label="Notifications and alerts">
              <Bell aria-hidden className="size-4" />
            </Link>
          </Button>
          <UserMenu {...props.user} />
        </div>
      </header>
      {allBranches && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-info-border bg-info-bg px-4 py-1.5 text-small text-info lg:px-6"
        >
          <Globe aria-hidden className="size-3.5" />
          Viewing consolidated data across all branches
        </div>
      )}
    </div>
  );
}
