import { Skeleton } from "@/components/ui/skeleton";

/** Static frame shown while the per-user shell streams in: rail, sidebar, top bar, content. */
export function ShellSkeleton() {
  return (
    <div className="flex h-dvh overflow-hidden" aria-busy="true" aria-label="Loading">
      <div className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-border py-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="size-9 rounded-lg" />
        ))}
      </div>
      <div className="hidden w-[200px] shrink-0 flex-col gap-2 border-r border-border p-3 lg:flex">
        <Skeleton className="mb-4 h-9 w-32" />
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[60px] items-center gap-5 border-b border-border px-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-[300px]" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="p-6">
          <Skeleton className="h-28" />
          <Skeleton className="mt-6 h-72" />
        </div>
      </div>
    </div>
  );
}
