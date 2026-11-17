"use client";

import { LogOut, Moon, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Sun } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";

import { useShell } from "@/components/shell/shell-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Sliders button in the rail: theme and sidebar collapse. */
export function PreferencesMenu() {
  const { theme, setTheme } = useTheme();
  const { collapsed, toggle } = useShell();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label="Display preferences"
      >
        <SlidersHorizontal aria-hidden className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56 shadow-popover">
        <DropdownMenuLabel className="text-caption uppercase text-subtle-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "light"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden className="size-4" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden className="size-4" /> Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={toggle}>
          {collapsed ? <PanelLeftOpen aria-hidden className="size-4" /> : <PanelLeftClose aria-hidden className="size-4" />}
          {collapsed ? "Expand sidebar" : "Collapse sidebar"}
          <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Avatar button in the rail: who is signed in, and sign out. */
export function AccountMenu({ name, email, roleLabel, branchLabel }: { name: string; email: string; roleLabel: string; branchLabel: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-9 items-center justify-center rounded-full border border-border bg-surface text-small font-semibold text-foreground hover:border-border-strong"
        aria-label={`Account menu for ${name}`}
      >
        {initials(name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-64 shadow-popover">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="text-body font-medium text-foreground">{name}</span>
          <span className="truncate text-small text-muted-foreground">{email}</span>
          <span className="text-small text-muted-foreground">
            {roleLabel} · {branchLabel}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: "/login" })}>
          <LogOut aria-hidden className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
