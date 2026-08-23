import Link from 'next/link';

interface ErrorStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onRetry?: () => void;
  variant?: 'card' | 'inline';
}

function ErrorIcon() {
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
        d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
      />
    </svg>
  );
}

function InlineErrorIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
      />
    </svg>
  );
}

export default function ErrorState({
  title = 'Something went wrong',
  description = 'We couldn’t load this content. Please try again.',
  actionLabel = 'Try again',
  actionHref,
  onRetry,
  variant = 'card',
}: ErrorStateProps) {
  if (variant === 'inline') {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3"
        role="alert"
        aria-live="assertive"
      >
        <span className="mt-0.5 text-destructive" aria-hidden="true">
          <InlineErrorIcon />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {(onRetry || actionHref) && (
          <div className="shrink-0">
            {actionHref ? (
              <Link
                href={actionHref}
                className="inline-flex items-center justify-center rounded-md bg-background px-3 py-1.5 text-sm font-medium text-foreground border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {actionLabel}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center rounded-md bg-background px-3 py-1.5 text-sm font-medium text-foreground border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-12 sm:px-8 sm:py-16 text-center"
      role="alert"
      aria-live="assertive"
    >
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
        aria-hidden="true"
      >
        <ErrorIcon />
      </div>
      <h3 className="text-base sm:text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {(onRetry || actionHref) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {actionLabel}
            </button>
          ) : (
            <Link
              href={actionHref!}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {actionLabel}
            </Link>
          )}
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Go home
          </Link>
        </div>
      )}
    </div>
  );
}

export function CategoriesError({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      title="Couldn’t load categories"
      description="We’re having trouble loading categories right now. Please check your connection and try again."
      actionLabel="Retry"
      onRetry={onRetry}
    />
  );
}

export function LeaderboardError({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      title="Couldn’t load leaderboard"
      description="The leaderboard is temporarily unavailable. Please try again in a moment."
      actionLabel="Retry"
      onRetry={onRetry}
    />
  );
}

export function RecentBidsError({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      title="Couldn’t load recent bids"
      description="Recent bidding activity couldn’t be loaded. Please refresh to try again."
      actionLabel="Retry"
      onRetry={onRetry}
    />
  );
}

export function BidError({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      title="Couldn’t place your bid"
      description="Something went wrong while placing your bid. No payment was taken — please try again."
      actionLabel="Try again"
      onRetry={onRetry}
    />
  );
}

export function NetworkError({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      title="You’re offline"
      description="Please check your internet connection and try again."
      actionLabel="Retry"
      onRetry={onRetry}
    />
  );
}

export function InlineFormError({ message }: { message: string }) {
  return (
    <ErrorState
      variant="inline"
      title={message}
      description="Please correct the details and try again."
      actionLabel="Dismiss"
      onRetry={() => {}}
    />
  );
}
