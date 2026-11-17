import { cn } from "@/lib/utils";

/** Padded content column under the top bar. Full-bleed bands (KPI strips) sit outside it. */
export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1600px] px-6 py-6", className)}>{children}</div>;
}
