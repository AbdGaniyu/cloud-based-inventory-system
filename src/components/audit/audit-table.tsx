"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";

import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";
import type { AuditRow } from "@/server/services/audit-log.service";

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Lagos" });

type Json = AuditRow["after"];

/** Flattens to "a.b" → value so a diff can line keys up. Arrays stay whole (shown as JSON). */
function flatten(value: Json, prefix = ""): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? { [prefix]: value === null ? "—" : typeof value === "string" ? value : JSON.stringify(value) } : {};
  }
  return Object.entries(value).reduce<Record<string, string>>((acc, [k, v]) => ({ ...acc, ...flatten(v ?? null, prefix ? `${prefix}.${k}` : k) }), {});
}

function Diff({ before, after }: { before: Json; after: Json }) {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  if (keys.length === 0) return <p className="text-small text-muted-foreground">No details recorded.</p>;
  return (
    <table className="w-full text-small">
      <caption className="sr-only">Before and after</caption>
      <thead className="text-muted-foreground">
        <tr>
          <th scope="col" className="w-1/4 py-1 text-left font-medium">Field</th>
          <th scope="col" className="w-3/8 py-1 text-left font-medium">Before</th>
          <th scope="col" className="w-3/8 py-1 text-left font-medium">After</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const changed = a[k] !== b[k];
          return (
            <tr key={k} className="border-t border-border align-top">
              <th scope="row" className="py-1 pr-3 text-left font-mono font-normal">{k}</th>
              <td className={cn("py-1 pr-3 break-all", changed && a[k] !== undefined && "text-danger line-through decoration-danger/50")}>{a[k] ?? ""}</td>
              <td className={cn("py-1 break-all", changed && b[k] !== undefined && "text-success")}>{b[k] ?? ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Audit trail (DESIGN.md §5.12): read-only rows that expand to a before/after diff. */
export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const { hrefWith } = useUrlParams();
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-small">
        <caption className="sr-only">Audit log</caption>
        <thead className="bg-surface text-caption text-muted-foreground uppercase">
          <tr className="border-b border-border">
            <th scope="col" className="h-10 w-8 px-2"><span className="sr-only">Details</span></th>
            <th scope="col" className="px-3 text-left font-medium">When</th>
            <th scope="col" className="px-3 text-left font-medium">Who</th>
            <th scope="col" className="px-3 text-left font-medium">Branch</th>
            <th scope="col" className="px-3 text-left font-medium">Action</th>
            <th scope="col" className="px-3 text-left font-medium">Record</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const expanded = open === r.id;
            return (
              <Fragment key={r.id}>
                <tr className={cn("border-b border-border", expanded && "bg-muted/40")}>
                  <td className="px-2">
                    <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} details for ${r.action}`} onClick={() => setOpen(expanded ? null : r.id)} className="flex size-8 items-center justify-center rounded-md hover:bg-muted">
                      {expanded ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
                    </button>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{when.format(new Date(r.createdAt))}</td>
                  <td className="px-3">{r.userName ?? <span className="text-muted-foreground">Automatic job</span>}</td>
                  <td className="px-3">{r.branchName ?? "—"}</td>
                  <td className="px-3">
                    <a href={hrefWith({ action: r.action })} className="font-mono hover:underline">{r.action}</a>
                  </td>
                  <td className="px-3">
                    <span className="text-muted-foreground">{r.entityType}</span> {r.summary}
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-border bg-muted/20">
                    <td />
                    <td colSpan={5} className="px-3 py-3">
                      <Diff before={r.before} after={r.after} />
                      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                        {r.entityType} {r.entityId}
                        {r.ip ? ` · ${r.ip}` : ""}
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DateRangeFilter({ from, to }: { from?: string; to?: string }) {
  const { setParams } = useUrlParams();
  return (
    <div className="flex items-center gap-2 text-small">
      <label className="flex items-center gap-1.5">
        From <input type="date" value={from ?? ""} onChange={(e) => setParams({ from: e.target.value || null })} className="h-9 rounded-md border border-input bg-background px-2" />
      </label>
      <label className="flex items-center gap-1.5">
        To <input type="date" value={to ?? ""} onChange={(e) => setParams({ to: e.target.value || null })} className="h-9 rounded-md border border-input bg-background px-2" />
      </label>
    </div>
  );
}
