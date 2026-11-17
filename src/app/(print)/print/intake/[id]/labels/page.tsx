import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PrintButton } from "@/app/(print)/print/intake/[id]/labels/print-button";
import { formatMoney } from "@/lib/money";
import { requirePageAccess } from "@/server/auth/session";
import { code128Svg } from "@/server/barcode";
import { NotFoundError } from "@/server/errors";
import { getIntake } from "@/server/services/intake.service";

export const metadata: Metadata = { title: "Barcode labels" };

/** Accessory lines larger than this print one label per line instead of one per item. */
const MAX_LABELS = 600;

type Label = { key: string; name: string; sku: string; code: string; price: string };

export default function LabelsPage({ params, searchParams }: PageProps<"/print/intake/[id]/labels">) {
  return (
    <Suspense fallback={<p className="p-8 text-body">Preparing labels…</p>}>
      <Labels params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Labels({
  params,
  searchParams,
}: {
  params: PageProps<"/print/intake/[id]/labels">["params"];
  searchParams: PageProps<"/print/intake/[id]/labels">["searchParams"];
}) {
  const ctx = await requirePageAccess("intake.create");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const summary = await getIntake(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const perLine = query.per === "line";

  const labels: Label[] = [];
  for (const line of summary.lines) {
    if (line.trackingType === "SERIALIZED") {
      for (const unit of line.units) {
        labels.push({ key: unit.id, name: line.productName, sku: line.sku, code: unit.identifier, price: unit.sellingPrice });
      }
    } else {
      const copies = perLine ? 1 : line.quantity;
      for (let i = 0; i < copies && labels.length < MAX_LABELS; i++) {
        labels.push({ key: `${line.productId}-${i}`, name: line.productName, sku: line.sku, code: line.barcode ?? line.sku, price: line.unitSellingPrice });
      }
    }
  }
  const svgs = new Map(labels.map((l) => [l.code, ""]));
  for (const code of svgs.keys()) svgs.set(code, code128Svg(code));

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{"@page { size: A4; margin: 8mm; } @media print { body { background: #fff; } }"}</style>
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-6 py-4 print:hidden">
        <div className="mr-auto">
          <h1 className="text-h2">Barcode labels · {summary.number}</h1>
          <p className="text-small text-zinc-600">
            {labels.length} labels, 50 × 25 mm on A4. Devices get their IMEI/serial; accessories get the product barcode or SKU.
          </p>
        </div>
        <Link
          href={perLine ? `?` : `?per=line`}
          className="rounded-md border border-zinc-300 px-3 py-2 text-small hover:bg-zinc-100"
        >
          {perLine ? "One label per accessory item" : "One label per accessory line"}
        </Link>
        <Link href={`/inventory/intake/${summary.id}`} className="rounded-md border border-zinc-300 px-3 py-2 text-small hover:bg-zinc-100">
          Back to intake
        </Link>
        <PrintButton />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,50mm)] gap-0 p-6 print:p-0">
        {labels.map((label) => (
          <div
            key={label.key}
            className="flex h-[25mm] w-[50mm] break-inside-avoid flex-col justify-between overflow-hidden border border-dashed border-zinc-300 px-[2mm] py-[1.5mm] print:border-zinc-200"
          >
            <p className="truncate text-[8pt] leading-tight font-semibold">{label.name}</p>
            <div
              aria-label={`Barcode ${label.code}`}
              className="h-[9mm] w-full [&_svg]:h-full [&_svg]:w-full"
              // bwip-js output: generated SVG paths only, from our own identifier data.
              dangerouslySetInnerHTML={{ __html: svgs.get(label.code) ?? "" }}
            />
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate font-mono text-[6.5pt]">{label.code === label.sku ? label.sku : `${label.code} · ${label.sku}`}</span>
              <span className="shrink-0 text-[8pt] font-bold tabular-nums">{formatMoney(label.price)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
