"use client";

import { AlertTriangle, CheckCircle2, Loader2, ScanBarcode } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { applyCount, reviewCount } from "@/app/(app)/inventory/actions";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CountReview, CountSheet } from "@/server/services/stock-adjustment.service";

const normalise = (code: string) => code.trim().replace(/\s+/g, "").toUpperCase();

/**
 * Count sheet: type what is on the shelf for each accessory (blank = not counted, left alone) and
 * scan every device (a scanner types the code and Enter, one per line). Review shows the
 * differences; Apply records them as adjustments in one go.
 */
export function CountForm({ sheet }: { sheet: CountSheet }) {
  const router = useRouter();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [countDevices, setCountDevices] = useState(sheet.units.length > 0);
  const [scanText, setScanText] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const [review, setReview] = useState<CountReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, startReview] = useTransition();
  const [applying, startApply] = useTransition();

  const scanned = useMemo(() => scanText.split(/\r?\n/).map(normalise).filter(Boolean), [scanText]);
  const scannedSet = useMemo(() => new Set(scanned), [scanned]);
  const matched = sheet.units.filter((u) => scannedSet.has(normalise(u.identifier))).length;
  const shown = sheet.accessories.filter((a) => !filter || `${a.name} ${a.sku}`.toLowerCase().includes(filter.toLowerCase()));

  const input = () => ({
    branchId: sheet.branch.id,
    accessories: sheet.accessories
      .filter((a) => (counted[a.productId] ?? "").trim() !== "")
      .map((a) => ({ productId: a.productId, expected: a.expected, counted: Number(counted[a.productId]) })),
    scanned,
    sheetUnitIds: sheet.units.map((u) => u.id),
    countDevices,
    note,
  });
  const linesCounted = Object.values(counted).filter((v) => v.trim() !== "").length;
  // Any edit invalidates the review: it must be looked at again before applying.
  const touch = () => setReview(null);
  const changes = review ? review.accessories.length + review.missing.length : 0;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="acc-heading" className="rounded-xl border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 id="acc-heading" className="text-h3">Accessories</h2>
              <p className="text-small text-muted-foreground">Type what is on the shelf. Leave a line blank if you didn&apos;t count it.</p>
            </div>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a line" aria-label="Find an accessory line" className="w-56" />
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-small">
              <caption className="sr-only">Accessory count at {sheet.branch.name}</caption>
              <thead className="sticky top-0 bg-surface text-caption text-muted-foreground uppercase">
                <tr className="border-b border-border">
                  <th scope="col" className="h-10 px-4 text-left font-medium">Accessory</th>
                  <th scope="col" className="px-3 text-right font-medium">System</th>
                  <th scope="col" className="px-3 text-right font-medium">Counted</th>
                  <th scope="col" className="px-4 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => {
                  const value = counted[a.productId] ?? "";
                  const diff = value.trim() === "" ? null : Number(value) - a.expected;
                  return (
                    <tr key={a.productId} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-2">
                        <p className="text-body font-medium">{a.name}</p>
                        <p className="font-mono text-small text-muted-foreground">{a.sku}</p>
                      </td>
                      <td className="px-3 text-right tabular-nums">{a.expected}</td>
                      <td className="px-3 text-right">
                        <Input
                          inputMode="numeric"
                          aria-label={`Counted ${a.name}`}
                          value={value}
                          onChange={(e) => {
                            touch();
                            setCounted((c) => ({ ...c, [a.productId]: e.target.value.replace(/[^\d]/g, "") }));
                          }}
                          className="ml-auto h-8 w-20 text-right tabular-nums"
                        />
                      </td>
                      <td className={cn("px-4 text-right tabular-nums", diff !== null && diff < 0 && "text-danger", diff !== null && diff > 0 && "text-success")}>
                        {diff === null ? <span className="text-muted-foreground">—</span> : diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="dev-heading" className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="dev-heading" className="flex items-center gap-2 text-h3">
              <ScanBarcode aria-hidden className="size-5" /> Devices
            </h2>
            <label className="flex items-center gap-2 text-body">
              <input type="checkbox" className="size-4" checked={countDevices} onChange={(e) => { touch(); setCountDevices(e.target.checked); }} /> Count devices too
            </label>
          </div>
          {countDevices ? (
            <>
              <p className="mt-1 mb-3 text-small text-muted-foreground">
                Scan every phone, laptop and console on the shelf, or paste the IMEIs/serials, one per line. Devices the system expects but you didn&apos;t scan
                are written off as lost when you apply.
              </p>
              <Textarea
                rows={8}
                value={scanText}
                onChange={(e) => { touch(); setScanText(e.target.value); }}
                aria-label="Scanned IMEIs and serial numbers"
                placeholder="Scan here…"
                className="font-mono"
              />
              <p className="mt-2 text-small">
                <span className="font-medium tabular-nums">{matched}</span> of <span className="tabular-nums">{sheet.units.length}</span> expected devices scanned
                {scanned.length > matched && <span className="text-warning"> · {scanned.length - matched} code{scanned.length - matched === 1 ? "" : "s"} not expected here</span>}
              </p>
            </>
          ) : (
            <p className="mt-1 text-small text-muted-foreground">Devices are left as they are.</p>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-4">
        <section aria-labelledby="review-heading" className="rounded-xl border border-border bg-card p-4">
          <h2 id="review-heading" className="text-h3">Review and apply</h2>
          <p className="mt-1 text-small text-muted-foreground">
            {linesCounted} accessory line{linesCounted === 1 ? "" : "s"} counted{countDevices ? `, ${matched}/${sheet.units.length} devices scanned` : ""}.
          </p>
          <label className="mt-3 flex flex-col gap-1.5 text-small font-medium">
            Note <span className="font-normal text-muted-foreground">(optional, saved with every change)</span>
            <Input value={note} onChange={(e) => { touch(); setNote(e.target.value); }} placeholder="e.g. Month-end count, Femi and Ada" />
          </label>
          {error && <p role="alert" className="mt-3 text-small text-danger">{error}</p>}
          {!review && (
            <Button
              className="mt-4 w-full"
              disabled={reviewing || (linesCounted === 0 && !countDevices)}
              onClick={() =>
                startReview(async () => {
                  setError(null);
                  const r = await reviewCount(input());
                  if (r.ok) setReview(r.data);
                  else setError(r.error);
                })
              }
            >
              {reviewing && <Loader2 aria-hidden className="animate-spin" />} Review differences
            </Button>
          )}
          {review && (
            <div className="mt-4 flex flex-col gap-3 text-body">
              {review.moved.length > 0 && (
                <p role="alert" className="flex gap-2 rounded-lg border border-warning-border bg-warning-bg p-3 text-small">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                  Stock changed while you were counting: {review.moved.map((m) => `${m.name} (${m.atStart} → ${m.now})`).join(", ")}. Reload the page and count those lines again.
                </p>
              )}
              {changes === 0 && review.moved.length === 0 ? (
                <p className="flex items-center gap-2 text-success">
                  <CheckCircle2 aria-hidden className="size-5" /> Everything matches. Nothing to change.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {review.accessories.map((a) => (
                    <li key={a.productId} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">{a.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {a.expected} → {a.counted}
                      </span>
                    </li>
                  ))}
                  {review.missing.map((m) => (
                    <li key={m.id} className="flex justify-between gap-3 text-danger">
                      <span className="min-w-0 truncate">{m.label}</span>
                      <span className="shrink-0">not found → write off</span>
                    </li>
                  ))}
                </ul>
              )}
              {review.unexpected.length > 0 && (
                <div className="rounded-lg bg-surface p-3 text-small">
                  <p className="font-medium">Scanned but not expected here (nothing is changed for these):</p>
                  <ul className="mt-1 font-mono">
                    {review.unexpected.map((u) => (
                      <li key={u.identifier}>
                        {u.identifier} <span className="font-sans text-muted-foreground">· {u.where}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {changes > 0 && (
                <p className="flex justify-between border-t border-border pt-2 font-medium">
                  Net value at cost <Money value={review.netValue} className={Number(review.netValue) < 0 ? "text-danger" : undefined} />
                </p>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setReview(null)}>Back</Button>
                <Button
                  className="flex-1"
                  variant={review.missing.length > 0 ? "destructive" : "default"}
                  disabled={applying || changes === 0 || review.moved.length > 0}
                  onClick={() =>
                    startApply(async () => {
                      setError(null);
                      const r = await applyCount(input());
                      if (!r.ok) {
                        setReview(null);
                        return setError(r.error);
                      }
                      toast.success(`Stock count saved: ${r.data.adjustments} adjustment${r.data.adjustments === 1 ? "" : "s"}`);
                      router.push("/inventory?tab=adjustments");
                    })
                  }
                >
                  {applying && <Loader2 aria-hidden className="animate-spin" />} Apply {changes} change{changes === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
