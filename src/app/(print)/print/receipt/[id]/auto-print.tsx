"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Print button, and opens the print dialog on load when the POS asked for it (?autoprint=1). */
export function ReceiptPrintControls({ autoPrint }: { autoPrint: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [autoPrint]);

  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer aria-hidden data-icon="inline-start" /> Print receipt
    </Button>
  );
}
