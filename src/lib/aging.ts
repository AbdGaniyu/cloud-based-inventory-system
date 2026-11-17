/** Aging buckets (CLAUDE.md §7.8): Not yet due, 1–7, 8–14, 15–30 and 30+ days overdue. */
export const AGING_BUCKETS = ["not_due", "d1_7", "d8_14", "d15_30", "d30_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABELS: Record<AgingBucket, string> = {
  not_due: "Not yet due",
  d1_7: "1–7 days",
  d8_14: "8–14 days",
  d15_30: "15–30 days",
  d30_plus: "30+ days",
};

/** `daysOverdue` ≤ 0 (or no due date) is not yet due; day 1 is the day after the due date. */
export function agingBucket(daysOverdue: number | null): AgingBucket {
  if (daysOverdue === null || daysOverdue <= 0) return "not_due";
  if (daysOverdue <= 7) return "d1_7";
  if (daysOverdue <= 14) return "d8_14";
  if (daysOverdue <= 30) return "d15_30";
  return "d30_plus";
}

export function isAgingBucket(value: string): value is AgingBucket {
  return (AGING_BUCKETS as readonly string[]).includes(value);
}
