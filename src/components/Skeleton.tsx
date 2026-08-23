function Skeleton({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-muted motion-safe:animate-pulse ${className}`}
      aria-hidden="true"
      {...props}
    />
  );
}

export function CategoryCardSkeleton() {
  return (
    <div
      className="flex flex-col rounded-xl border border-border bg-background p-6"
      aria-hidden="true"
    >
      <Skeleton className="h-5 w-3/5 rounded-md" />
      <Skeleton className="mt-2 h-3 w-full rounded-md" />
      <Skeleton className="mt-1.5 h-3 w-4/5 rounded-md" />
      <div className="mt-auto pt-4 border-t border-border">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Skeleton className="h-3 w-12 rounded" />
            <Skeleton className="mt-2 h-4 w-20 rounded" />
          </div>
          <div>
            <Skeleton className="h-3 w-12 rounded" />
            <Skeleton className="mt-2 h-4 w-10 rounded" />
          </div>
        </div>
        <Skeleton className="mt-3 h-3 w-full rounded" />
        <Skeleton className="mt-3 h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function CategoryCardsSkeleton() {
  return (
    <section className="py-12 sm:py-16 lg:py-20" aria-label="Loading categories" aria-busy="true">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <Skeleton className="mx-auto h-8 w-64 rounded-md" />
          <Skeleton className="mx-auto mt-4 h-5 w-96 max-w-full rounded-md" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <CategoryCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function LeaderboardSkeleton() {
  return (
    <section className="py-12 sm:py-16 lg:py-20" aria-label="Loading leaderboard" aria-busy="true">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <Skeleton className="mx-auto h-8 w-72 rounded-md" />
          <Skeleton className="mx-auto mt-4 h-5 w-80 max-w-full rounded-md" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="border-b border-border bg-muted/50 px-4 sm:px-6 py-3 flex gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-16 rounded" />
            ))}
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 sm:px-6 py-4">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <Skeleton className="h-10 w-10 rounded-full shrink-0 hidden sm:block" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24 rounded" />
                  <Skeleton className="h-3 w-32 rounded" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full hidden sm:block" />
                <Skeleton className="h-5 w-20 rounded ml-auto sm:ml-0" />
                <Skeleton className="h-3 w-12 rounded hidden sm:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function RecentBidsSkeleton() {
  return (
    <section
      className="py-12 sm:py-16 lg:py-20 bg-muted/20 border-y border-border"
      aria-label="Loading recent bids"
      aria-busy="true"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-8">
          <div>
            <Skeleton className="h-8 w-48 rounded-md" />
            <Skeleton className="mt-2 h-4 w-64 rounded-md" />
          </div>
          <Skeleton className="h-4 w-16 rounded" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <ul className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <li
                key={i}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Skeleton className="hidden sm:flex h-10 w-10 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-24 rounded" />
                      <Skeleton className="h-4 w-16 rounded-full" />
                      <Skeleton className="h-3 w-12 rounded" />
                    </div>
                    <Skeleton className="h-3 w-32 rounded" />
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:pl-4">
                  <Skeleton className="h-5 w-20 rounded" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function BidModalSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-background p-6 space-y-6" aria-hidden="true">
      <Skeleton className="h-6 w-40 rounded" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
      <div className="flex justify-end gap-3">
        <Skeleton className="h-10 w-24 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>
    </div>
  );
}

export default Skeleton;
