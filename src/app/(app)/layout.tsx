import { cookies } from "next/headers";
import { Suspense } from "react";

import { BranchSwitcher } from "@/components/branch/BranchSwitcher";
import { NavSidebar } from "@/components/shell/nav-sidebar";
import { visibleNav } from "@/components/shell/nav-config";
import { NAV_COLLAPSED_COOKIE, ShellProvider } from "@/components/shell/shell-provider";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { TopBar } from "@/components/shell/top-bar";
import { AccountMenu, PreferencesMenu } from "@/components/shell/user-menu";
import { STORE } from "@/config/store";
import { can } from "@/server/auth/permissions";
import { requireSession, roleLabel } from "@/server/auth/session";
import { listScopeBranches } from "@/server/services/branch.service";
import { getShellSummary } from "@/server/services/shell.service";

/**
 * Authenticated shell: branch rail · sidebar · top bar (DESIGN.md §3, docs/design/mockups).
 * Everything in it is per-user, so the prerendered static shell is a skeleton and the real shell
 * streams in under Suspense (Cache Components). Every page and service does its own permission check.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();
  const [branches, summary, cookieStore] = await Promise.all([listScopeBranches(ctx), getShellSummary(ctx), cookies()]);
  const collapsedCookie = cookieStore.get(NAV_COLLAPSED_COOKIE)?.value;
  const nav = visibleNav(ctx);
  const active = branches.find((b) => b.id === ctx.activeBranchId);
  const scopeLabel = active ? `${active.name} · ${active.code}` : "All branches · ALL";
  const user = {
    name: ctx.name,
    email: ctx.email,
    roleLabel: roleLabel(ctx.role),
    branchLabel: ctx.homeBranch?.name ?? "All branches",
  };

  return (
    <ShellProvider initialCollapsed={collapsedCookie === "1" ? true : collapsedCookie === "0" ? false : null}>
      <div className="flex h-dvh overflow-hidden bg-background">
        <aside
          aria-label="Branches and account"
          className="flex w-14 shrink-0 flex-col items-center justify-between border-r border-border bg-background py-3"
        >
          <BranchSwitcher
            branches={branches}
            activeBranchId={ctx.activeBranchId}
            canSwitch={can(ctx, "branch.viewAll")}
            branchAlerts={summary.branchAlerts}
          />
          <div className="flex flex-col items-center gap-3">
            <PreferencesMenu />
            <AccountMenu {...user} />
          </div>
        </aside>
        <NavSidebar nav={nav} counts={summary.counts} storeName={STORE.name} scopeLabel={scopeLabel} user={user} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar nav={nav} alerts={summary.alerts} />
          {ctx.activeBranchId === null && (
            <div role="status" className="flex shrink-0 items-center gap-2 border-b border-info-border/60 bg-info-bg px-6 py-1.5 text-small text-info">
              <span aria-hidden className="size-1.5 rounded-full bg-info" />
              Viewing consolidated data across all branches
            </div>
          )}
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </ShellProvider>
  );
}
