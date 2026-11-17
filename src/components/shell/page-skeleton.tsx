import { Skeleton } from "@/components/ui/skeleton";

/** Content-shaped skeleton: page header, a row of cards, a table. No full-page spinner. */
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-5 w-80" />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="mt-6 h-72" />
    </div>
  );
}
