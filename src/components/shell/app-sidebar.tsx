"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import type { NavGroup } from "@/components/shell/nav-config";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { STORE } from "@/config/store";

const SIDEBAR_COOKIE = "sidebar_state";
const COLLAPSE_BELOW_PX = 1280;

function isActive(pathname: string, href: string, allHrefs: string[]): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  // /inventory must not light up while /inventory/intake (its own nav item) is open.
  return !allHrefs.some((other) => other !== href && other.startsWith(`${href}/`) && pathname.startsWith(other));
}

/** Collapse to the icon rail on first visit below 1280px; afterwards the user's choice (cookie) wins. */
function AutoCollapse() {
  const { setOpen } = useSidebar();
  useEffect(() => {
    const hasPreference = document.cookie.split("; ").some((c) => c.startsWith(`${SIDEBAR_COOKIE}=`));
    if (!hasPreference && window.innerWidth < COLLAPSE_BELOW_PX) setOpen(false);
  }, [setOpen]);
  return null;
}

export function AppSidebar({ nav }: { nav: NavGroup[] }) {
  const pathname = usePathname();
  const allHrefs = nav.flatMap((g) => g.items.map((i) => i.href));

  return (
    <Sidebar collapsible="icon">
      <AutoCollapse />
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <Link href="/dashboard" className="flex items-center gap-2 px-1 font-semibold text-h3">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-small font-bold text-primary-foreground"
          >
            {STORE.name.slice(0, 1)}
          </span>
          <span className="truncate group-data-[collapsible=icon]:hidden">{STORE.name}</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {nav.map((group) => (
          <SidebarGroup key={group.label ?? "home"}>
            {group.label && <SidebarGroupLabel className="text-caption uppercase">{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.icon];
                  const active = isActive(pathname, item.href, allHrefs);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href} aria-current={active ? "page" : undefined}>
                          <Icon aria-hidden />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
