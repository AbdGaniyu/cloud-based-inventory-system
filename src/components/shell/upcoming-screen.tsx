import { Hammer } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

/** Interim content for routes whose screen lands in a later build step (CLAUDE.md §12). */
export function UpcomingScreen({ step, summary }: { step: number; summary: string }) {
  return <EmptyState icon={Hammer} title={`Arrives in build step ${step}`} description={summary} />;
}
