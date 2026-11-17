import { Skeleton } from "@/components/ui/skeleton";

/** Static frame shown while the per-user shell streams in: sidebar, top bar, content. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen" aria-busy="true" aria-label="Loading">
      <div className="hidden w-[240px] shrink-0 flex-col gap-3 border-r border-border bg-surface p-3 md:flex">
        <Skeleton className="h-8 w-32" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4 lg:px-6">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="ml-auto h-9 w-56" />
          <Skeleton className="size-8 rounded-full" />
        </div>
        <div className="p-4 lg:p-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-5 w-80" />
          <Skeleton className="mt-6 h-72" />
        </div>
      </div>
    </div>
  );
}
