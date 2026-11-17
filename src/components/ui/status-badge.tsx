import type { InvoiceStatus, PurchaseOrderStatus, ScheduleStatus, TransferStatus, UnitCondition, UnitStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/** One label and one colour per status, everywhere (DESIGN.md §2.4). */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  success: "border-success-border bg-success-bg text-success",
  warning: "border-warning-border bg-warning-bg text-warning",
  danger: "border-danger-border bg-danger-bg text-danger",
  info: "border-info-border bg-info-bg text-info",
  neutral: "border-neutral-border bg-neutral-bg text-neutral",
};

const DOT_CLASSES: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-neutral",
};

export function Badge({ tone, children, dot = true, className }: { tone: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-[12px] font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", DOT_CLASSES[tone])} />}
      {children}
    </span>
  );
}

const UNIT_STATUS: Record<UnitStatus, { label: string; tone: Tone }> = {
  IN_STOCK: { label: "In Stock", tone: "success" },
  IN_TRANSIT: { label: "In Transit", tone: "info" },
  SOLD: { label: "Sold", tone: "neutral" },
  RETURNED: { label: "Returned", tone: "warning" },
  TRADED_IN: { label: "Traded In", tone: "warning" },
  DEFECTIVE: { label: "Defective", tone: "danger" },
};

export function UnitStatusBadge({ status }: { status: UnitStatus }) {
  const s = UNIT_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const PO_STATUS: Record<PurchaseOrderStatus | "OVERDUE", { label: string; tone: Tone }> = {
  PAID: { label: "Paid", tone: "success" },
  PARTIALLY_PAID: { label: "Partially Paid", tone: "warning" },
  UNPAID: { label: "Unpaid", tone: "neutral" },
  OVERDUE: { label: "Overdue", tone: "danger" },
};

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus | "OVERDUE" }) {
  const s = PO_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const CONDITION_LABELS: Record<UnitCondition, string> = {
  BRAND_NEW: "Brand New",
  OPEN_BOX: "Open Box",
  UK_USED: "UK Used",
  US_USED: "US Used",
  REFURBISHED: "Refurbished",
};

/** Outline badge, no fill (DESIGN.md §2.4). */
export function ConditionBadge({ condition }: { condition: UnitCondition }) {
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center rounded-full border border-border-strong px-2 text-[12px] font-medium whitespace-nowrap text-foreground">
      {CONDITION_LABELS[condition]}
    </span>
  );
}

const TRANSFER_STATUS: Record<TransferStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  IN_TRANSIT: { label: "In Transit", tone: "info" },
  RECEIVED: { label: "Received", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const s = TRANSFER_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const INVOICE_STATUS: Record<InvoiceStatus | "OVERDUE", { label: string; tone: Tone }> = {
  PAID: { label: "Paid", tone: "success" },
  PARTIALLY_PAID: { label: "Partially Paid", tone: "warning" },
  UNPAID: { label: "Unpaid", tone: "neutral" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  VOID: { label: "Void", tone: "neutral" },
  RETURNED: { label: "Returned", tone: "neutral" },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus | "OVERDUE" }) {
  const s = INVOICE_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Installment row status; "Due soon" when unpaid and due within 3 days (DESIGN.md §2.4). */
export function ScheduleStatusBadge({ status, dueSoon }: { status: ScheduleStatus; dueSoon?: boolean }) {
  if (status === "PAID") return <Badge tone="success">Paid</Badge>;
  if (status === "OVERDUE") return <Badge tone="danger">Overdue</Badge>;
  if (status === "WAIVED") return <Badge tone="neutral" className="italic">Waived</Badge>;
  if (dueSoon) return <Badge tone="warning">Due soon</Badge>;
  return <Badge tone="neutral">{status === "PARTIAL" ? "Part paid" : "Pending"}</Badge>;
}
