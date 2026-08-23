import Link from 'next/link';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 sm:px-8 sm:py-16 text-center"
      role="status"
      aria-live="polite"
    >
      {icon && (
        <div
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <h3 className="text-base sm:text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {actionLabel && (actionHref || onAction) && (
        <div className="mt-6">
          {actionHref ? (
            <Link
              href={actionHref}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {actionLabel}
            </Link>
          ) : (
            <button
              type="button"
              onClick={onAction}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CategoriesIcon() {
  return (
    <svg
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
      />
    </svg>
  );
}

function LeaderboardIcon() {
  return (
    <svg
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
      />
    </svg>
  );
}

function BidsIcon() {
  return (
    <svg
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
      />
    </svg>
  );
}

export function EmptyCategories({ onBrowse }: { onBrowse?: () => void }) {
  return (
    <EmptyState
      icon={<CategoriesIcon />}
      title="No categories yet"
      description="Categories will appear here once the admin creates them. Check back soon or explore how bidding works."
      actionLabel="How bidding works"
      actionHref="/#categories-heading"
      onAction={onBrowse}
    />
  );
}

export function EmptyLeaderboard() {
  return (
    <EmptyState
      icon={<LeaderboardIcon />}
      title="No bids yet — be the first!"
      description="No one has placed a bid yet. Pick a category and claim the #1 spot on the leaderboard."
      actionLabel="View categories"
      actionHref="/#categories-heading"
    />
  );
}

export function EmptyRecentBids() {
  return (
    <EmptyState
      icon={<BidsIcon />}
      title="No recent bids"
      description="When bids come in, they’ll show up here in real time. Be the first to make a move."
      actionLabel="Place your first bid"
      actionHref="/#categories-heading"
    />
  );
}

export function EmptySearchResults({ query }: { query?: string }) {
  return (
    <EmptyState
      icon={<BidsIcon />}
      title={query ? `No results for "${query}"` : 'No results found'}
      description="Try adjusting your search or browse all categories to find what you’re looking for."
      actionLabel="Browse categories"
      actionHref="/#categories-heading"
    />
  );
}
