"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const NAV_COLLAPSED_COOKIE = "gh_nav_collapsed";
const COLLAPSE_BELOW_PX = 1280;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type ShellState = { collapsed: boolean; setCollapsed: (value: boolean) => void; toggle: () => void };

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <ShellProvider>");
  return value;
}

/**
 * Sidebar collapse state. `initialCollapsed` comes from the cookie (null = no preference yet);
 * with no preference the sidebar collapses on narrow screens (< 1280px, DESIGN.md §3).
 */
export function ShellProvider({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean | null;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed ?? false);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    document.cookie = `${NAV_COLLAPSED_COOKIE}=${value ? "1" : "0"}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  }, []);
  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  useEffect(() => {
    if (initialCollapsed !== null || window.innerWidth >= COLLAPSE_BELOW_PX) return;
    // First visit on a tablet: start collapsed without storing a preference.
    const frame = requestAnimationFrame(() => setCollapsedState(true));
    return () => cancelAnimationFrame(frame);
  }, [initialCollapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggle();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const value = useMemo(() => ({ collapsed, setCollapsed, toggle }), [collapsed, setCollapsed, toggle]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
