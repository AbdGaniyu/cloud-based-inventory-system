import Link from "next/link";

import { cn } from "@/lib/utils";

export type SummaryItem = {
  label: string;
  value: React.ReactNode;
  /** Full value for abbreviated figures. */
  title?: string;
  sub?: React.ReactNode;
  tone?: "danger" | "warning";
  href?: string;
};

/** Full-width grey band of summary figures separated by hairlines (mockups: "Ledger summary"). */
export function SummaryBand({ title, items, actions }: { title: string; items: SummaryItem[]; actions?: React.ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-border bg-surface">
      <div className="mx-auto w-full max-w-[1600px] px-6 pt-5 pb-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-h2 text-foreground">{title}</h2>
          {actions}
        </div>
        <dl className="grid grid-cols-2 gap-y-4 md:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
          {items.map((item, index) => {
            const body = (
              <>
                <dt className="text-body text-muted-foreground">{item.label}</dt>
                <dd
                  title={item.title}
                  className={cn(
                    "mt-1 text-[28px] leading-9 font-semibold tracking-tight tabular-nums",
                    item.tone === "danger" ? "text-danger" : item.tone === "warning" ? "text-warning" : "text-foreground",
                  )}
                >
                  {item.value}
                </dd>
                {item.sub && <dd className="mt-0.5 text-small text-muted-foreground">{item.sub}</dd>}
              </>
            );
            return (
              <div key={item.label} className={cn("px-6 first:pl-0", index > 0 && "md:border-l md:border-border")}>
                {item.href ? (
                  <Link href={item.href} className="block rounded-md hover:opacity-80">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
