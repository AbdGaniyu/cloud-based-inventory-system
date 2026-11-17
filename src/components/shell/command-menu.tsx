"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { NavGroup } from "@/components/shell/nav-config";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/** ⌘K / Ctrl-K palette. Page jumps now; invoice, phone and IMEI lookup are added with their services. */
export function CommandMenu({ nav }: { nav: NavGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <Button
        variant="outline"
        className="w-56 justify-start gap-2 font-normal text-subtle-foreground max-lg:w-9 max-lg:justify-center max-lg:px-0"
        onClick={() => setOpen(true)}
        aria-label="Search and jump to (Ctrl K)"
      >
        <Search aria-hidden className="size-4" />
        <span className="max-lg:hidden">Search…</span>
        <kbd className="ml-auto rounded-sm border border-border bg-surface px-1.5 font-mono text-caption max-lg:hidden">⌘K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a page">
        <Command>
          <CommandInput placeholder="Jump to a page…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {nav.map((group) => (
              <CommandGroup key={group.label ?? "home"} heading={group.label ?? "General"}>
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.icon];
                  return (
                    <CommandItem key={item.href} value={`${group.label ?? ""} ${item.label}`} onSelect={() => go(item.href)}>
                      <Icon aria-hidden className="size-4" />
                      {item.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
