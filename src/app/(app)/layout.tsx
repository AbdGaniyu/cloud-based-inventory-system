import { cookies } from "next/headers";
import { Suspense } from "react";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { visibleNav } from "@/components/shell/nav-config";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { TopBar } from "@/components/shell/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { can } from "@/server/auth/permissions";
import { requireSession, roleLabel } from "@/server/auth/session";
import { listScopeBranches } from "@/server/services/branch.service";

const SIDEBAR_STYLE = { "--sidebar-width": "240px", "--sidebar-width-icon": "64px" } as React.CSSProperties;

/**
 * Authenticated shell. Everything in it is per-user (role-filtered nav, branch scope), so the
 * prerendered static shell is a skeleton frame and the real shell streams in under Suspense
 * (Cache Components). This layout only reads the session to draw the chrome; every page and
 * service performs its own permission check (layouts don't re-run on client navigation).
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
  const [branches, cookieStore] = await Promise.all([listScopeBranches(ctx), cookies()]);
  const sidebarCookie = cookieStore.get("sidebar_state")?.value;
  const nav = visibleNav(ctx);

  return (
    <SidebarProvider defaultOpen={sidebarCookie !== "false"} style={SIDEBAR_STYLE}>
      <AppSidebar nav={nav} />
      <SidebarInset className="min-w-0">
        <TopBar
          nav={nav}
          branches={branches}
          activeBranchId={ctx.activeBranchId}
          canSwitch={can(ctx, "branch.viewAll")}
          user={{
            name: ctx.name,
            email: ctx.email,
            roleLabel: roleLabel(ctx.role),
            branchLabel: ctx.homeBranch?.name ?? "All branches",
          }}
        />
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 lg:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
