import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Checkout cancelled — Topbid.lol',
};

function CancelledIcon() {
  return (
    <svg
      className="h-6 w-6 motion-safe:animate-[scaleIn_300ms_ease-out]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default function CancelPage() {
  return (
    <section className="py-12 sm:py-16" aria-label="Checkout cancelled">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div
          className="mx-auto max-w-2xl flex flex-col items-center justify-center rounded-xl border border-border bg-muted/40 px-6 py-10 sm:px-8 sm:py-12 text-center"
          role="status"
          aria-live="polite"
        >
          <div
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground motion-safe:animate-[scaleIn_300ms_ease-out] motion-reduce:animate-none"
            aria-hidden="true"
          >
            <CancelledIcon />
          </div>
          <h1 className="text-base sm:text-lg font-semibold text-foreground">Checkout cancelled</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            You closed the checkout before completing your bid. No payment was taken and nothing was
            charged to your payment method. Pick a category and try again whenever you&apos;re
            ready.
          </p>
          <div className="mt-6 flex w-full flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
            >
              Browse categories
            </Link>
            <Link
              href="/#leaderboard-heading"
              className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
            >
              View Leaderboard
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
