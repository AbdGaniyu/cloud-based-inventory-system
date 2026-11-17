import type { LucideIcon } from "lucide-react";

/** Icon, one-line explanation, at most one primary action. No illustrations (DESIGN.md §4). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon aria-hidden className="size-5 text-muted-foreground" />
      </span>
      <p className="text-h3 text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-md text-body text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
