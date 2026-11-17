import { ClipboardList } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { IdentifierChip } from "@/components/identifier-chip";
import { Money } from "@/components/money";
import { REASON_LABELS } from "@/lib/stock-adjustments";
import { cn } from "@/lib/utils";
import type { AdjustmentRow } from "@/server/services/stock-adjustment.service";

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

/** Owner: every stock adjustment, newest first, with its value at cost (negative = loss). */
export function AdjustmentsTable({ rows }: { rows: AdjustmentRow[] }) {
  if (rows.length === 0) {
    return <EmptyState icon={ClipboardList} title="No adjustments yet" description="Damage, losses, finds and stock-count corrections will be listed here with who made them and why." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-small">
        <caption className="sr-only">Stock adjustments</caption>
        <thead className="bg-surface text-caption text-muted-foreground uppercase">
          <tr className="border-b border-border">
            <th scope="col" className="h-10 px-3 text-left font-medium">When</th>
            <th scope="col" className="px-3 text-left font-medium">Item</th>
            <th scope="col" className="px-3 text-left font-medium">Change</th>
            <th scope="col" className="px-3 text-left font-medium">Reason</th>
            <th scope="col" className="px-3 text-left font-medium">By</th>
            <th scope="col" className="px-3 text-right font-medium">Value at cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border align-top last:border-b-0">
              <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                {when.format(new Date(r.createdAt))}
                <p className="text-small">{r.branchName}</p>
              </td>
              <td className="px-3 py-2.5">
                <p className="text-body font-medium">{r.productName}</p>
                {r.identifier && <IdentifierChip value={r.identifier} />}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{r.change}</td>
              <td className="px-3 py-2.5">
                {REASON_LABELS[r.reason].replace(" (explain in the note)", "")}
                {r.fromCount && <span className="ml-1 text-muted-foreground">· stock count</span>}
                {r.note && <p className="max-w-72 text-muted-foreground">{r.note}</p>}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">{r.byName}</td>
              <td className={cn("px-3 py-2.5 text-right", Number(r.value) < 0 && "text-danger")}>
                <Money value={r.value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
