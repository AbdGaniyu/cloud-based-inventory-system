"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, type TooltipContentProps, XAxis, YAxis } from "recharts";

import { formatMoney, formatMoneyCompact } from "@/lib/money";

export type TrendPoint = { label: string; key: string; invoiced: number; collected: number };

const SERIES = [
  { key: "invoiced", name: "Invoiced", color: "var(--chart-1)" },
  { key: "collected", name: "Collected", color: "var(--chart-2)" },
] as const;

function TrendTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as TrendPoint | undefined;
  if (!point) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-small shadow-md">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center justify-between gap-4 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-sm" style={{ background: s.color }} /> {s.name}
          </span>
          <span className="text-foreground tabular-nums">{formatMoney(point[s.key])}</span>
        </p>
      ))}
    </div>
  );
}

/** Invoiced vs collected (DESIGN.md §5.1): two series, primary and neutral, grouped bars, one axis. */
export function TrendChart({ data, hourly }: { data: TrendPoint[]; hourly: boolean }) {
  const tickInterval = hourly ? 2 : data.length > 14 ? Math.ceil(data.length / 10) - 1 : 0;
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2} barCategoryGap={data.length > 14 ? "18%" : "28%"} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={tickInterval} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
          <YAxis
            width={56}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v: number) => formatMoneyCompact(v)}
          />
          <Tooltip content={TrendTooltip} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
          {SERIES.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
