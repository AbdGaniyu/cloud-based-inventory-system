"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Light is the default; dark is opt-in for back-office use (DESIGN.md §2). */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
