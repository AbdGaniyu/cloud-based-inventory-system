"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

import { matchNavItem, type NavCountKey, type NavCountTone, type NavGroup } from "@/components/shell/nav-config";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import { useShell } from "@/components/shell/shell-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const COUNT_STYLES: Record<NavCountTone, string> = {
  neutral: "bg-secondary text-muted-foreground",
  info: "bg-info-bg text-info",
  attention: "bg-badge text-badge-foreground",
};

function NavCount({ value, tone, collapsed }: { value: number; tone: NavCountTone; collapsed: boolean }) {
  if (value <= 0) return null;
  if (collapsed) {
    // Only attention counts survive the icon column, as a dot.
    return tone === "attention" ? (
      <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full border border-background bg-badge" />
    ) : null;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        COUNT_STYLES[tone],
      )}
    >
      {value > 999 ? "999+" : value}
    </span>
  );
}

export function NavSidebar({
  nav,
  counts,
  storeName,
  scopeLabel,
  user,
}: {
  nav: NavGroup[];
  counts: Record<NavCountKey, number>;
  storeName: string;
  scopeLabel: string;
  user: { name: string; roleLabel: string };
}) {
  const pathname = usePathname();
  const { collapsed } = useShell();
  const active = matchNavItem(nav, pathname);

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-background transition-[width] duration-150 ease-out",
        collapsed ? "w-14" : "w-[200px]",
      )}
    >
      <div className={cn("flex h-[60px] shrink-0 flex-col justify-center border-b border-border", collapsed ? "px-2" : "px-4")}>
        {collapsed ? (
          <span className="sr-only">
            {storeName} — {scopeLabel}
          </span>
        ) : (
          <>
            <span className="truncate text-h3 font-semibold text-foreground">{storeName}</span>
            <span className="truncate text-small text-muted-foreground">{scopeLabel}</span>
          </>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {nav.map((group, index) => (
          <Fragment key={group.label ?? "home"}>
            {index > 0 && <div aria-hidden className="mx-2 my-3 border-t border-border" />}
            {group.label && !collapsed && (
              <p className="mb-1 px-3 text-caption uppercase text-subtle-foreground">{group.label}</p>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                const isActive = active?.href === item.href;
                const count = item.count ? counts[item.count.key] : 0;
                const label = item.count && count > 0 ? `${item.label} (${count})` : item.label;
                const link = (
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={collapsed ? label : undefined}
                    className={cn(
                      "relative flex h-9 items-center gap-3 rounded-lg text-body text-foreground transition-colors duration-150 hover:bg-secondary",
                      collapsed ? "justify-center px-0" : "px-3",
                      isActive && "bg-accent font-medium text-accent-foreground",
                    )}
                  >
                    <Icon aria-hidden className={cn("size-[18px] shrink-0", isActive ? "text-foreground" : "text-neutral")} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {item.count && <NavCount value={count} tone={item.count.tone} collapsed={collapsed} />}
                    {!collapsed && item.count && count > 0 && <span className="sr-only">, {count}</span>}
                  </Link>
                );
                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">{label}</TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </Fragment>
        ))}
      </nav>

      {!collapsed && (
        <div className="shrink-0 border-t border-border px-4 py-3">
          <p className="truncate text-body font-medium text-foreground">{user.name}</p>
          <p className="truncate text-small text-muted-foreground">{user.roleLabel}</p>
        </div>
      )}
    </aside>
  );
}
