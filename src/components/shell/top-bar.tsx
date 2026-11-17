"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AlertsMenu } from "@/components/shell/alerts-menu";
import { CommandMenu } from "@/components/shell/command-menu";
import { matchNavItem, type NavGroup } from "@/components/shell/nav-config";
import { Button } from "@/components/ui/button";
import type { AlertBreakdown } from "@/server/services/shell.service";

/** Page title (the page's H1), search, alerts and the primary "New sale" action (DESIGN.md §3). */
export function TopBar({ nav, alerts }: { nav: NavGroup[]; alerts: AlertBreakdown }) {
  const pathname = usePathname();
  const item = matchNavItem(nav, pathname);
  const canSell = nav.some((g) => g.items.some((i) => i.href === "/pos"));
  const onPos = pathname === "/pos" || pathname.startsWith("/pos/");

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-5 border-b border-border bg-background px-6">
      <h1 className="shrink-0 text-h1 text-foreground">{item?.title ?? item?.label ?? ""}</h1>
      <CommandMenu nav={nav} />
      <div className="flex items-center gap-2">
        <AlertsMenu alerts={alerts} />
        {canSell && !onPos && (
          <Button asChild>
            <Link href="/pos">
              <Plus aria-hidden data-icon="inline-start" />
              New sale
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
