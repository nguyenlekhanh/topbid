import Link from 'next/link';

import CopyShareLink from '@/components/CopyShareLink';

interface SuccessStateProps {
  title?: string;
  description?: string;
  amount?: string;
  category?: string;
  reference?: string;
  note?: string;
  onClose?: () => void;
  onViewLeaderboard?: () => void;
  /** Absolute X web-intent URL; when present a "Share on X" action renders. */
  xShareUrl?: string;
  /** Canonical public share URL; when present a "Copy link" action renders (Task 7.3). */
  copyShareUrl?: string;
}

function SuccessIcon() {
  return (
    <svg
      className="h-6 w-6 motion-safe:animate-[scaleIn_300ms_ease-out]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
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
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

export default function SuccessState({
  title = 'Bid placed! (demo)',
  description = 'Your mock bid was recorded locally. No payment was processed — this is a UI preview for the bidding flow.',
  amount,
  category,
  reference,
  note = 'Demo reference — not a real payment confirmation.',
  onClose,
  onViewLeaderboard,
  xShareUrl,
  copyShareUrl,
}: SuccessStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-success/20 bg-success/5 px-6 py-10 sm:px-8 sm:py-12 text-center"
      role="status"
      aria-live="polite"
    >
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success text-success-foreground motion-safe:animate-[scaleIn_300ms_ease-out] motion-reduce:animate-none"
        aria-hidden="true"
      >
        <SuccessIcon />
      </div>
      <h3 className="text-base sm:text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>

      {(amount || category || reference) && (
        <div className="mt-6 w-full max-w-md rounded-lg border border-border bg-background p-4 text-left">
          <dl className="space-y-3 text-sm">
            {amount && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Bid amount</dt>
                <dd className="font-semibold text-foreground">{amount}</dd>
              </div>
            )}
            {category && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Category</dt>
                <dd className="font-medium text-foreground">{category}</dd>
              </div>
            )}
            {reference && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="font-mono text-xs text-foreground">{reference}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{note}</p>
        </div>
      )}

      <div className="mt-6 flex w-full flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
        {onViewLeaderboard ? (
          <button
            type="button"
            onClick={onViewLeaderboard}
            className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
          >
            View Leaderboard
          </button>
        ) : (
          <Link
            href="/#leaderboard-heading"
            className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
          >
            View Leaderboard
          </Link>
        )}
        {xShareUrl && (
          <a
            href={xShareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-foreground px-5 py-3 text-sm font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
          >
            <ExternalLinkIcon />
            Share on X
          </a>
        )}
        {copyShareUrl && <CopyShareLink url={copyShareUrl} />}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
          >
            Continue Browsing
          </button>
        ) : (
          <Link
            href="/"
            className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
          >
            Continue Browsing
          </Link>
        )}
      </div>
    </div>
  );
}

export function BidSuccessInline({
  amount,
  category,
  reference = 'BID-MOCK-0001',
}: {
  amount: string;
  category: string;
  reference?: string;
}) {
  return <SuccessState amount={amount} category={category} reference={reference} />;
}

export function BidSuccessPageExample() {
  return (
    <section className="py-12 sm:py-16" aria-label="Bid success example">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 max-w-2xl">
        <SuccessState amount="$1,300" category="Art & Collectibles" reference="BID-MOCK-4829" />
      </div>
    </section>
  );
}
