import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadCategoryPageData } from '@/lib/category-page';

// Static title only - dynamic/OG metadata is Task 7.5 scope and deliberately absent.
export const metadata: Metadata = {
  title: 'Category — Topbid.lol',
};

function formatAmount(amountCents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

/**
 * Public category page (Task 7.4).
 *
 * - Identity resolves exclusively through the authoritative slug query
 *   (getCategoryBySlug via loadCategoryPageData): active-only at the app level and
 *   under RLS, so nonexistent/inactive/malformed slugs uniformly render notFound()
 *   with no existence leak
 * - Every displayed fact comes from database rows; bid data is PAID-only public
 *   leaderboard data (no pending bids, no bidder emails, no Stripe identifiers)
 */
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const data = await loadCategoryPageData(slug);

  if (!data) {
    notFound();
  }

  const { category, highestBid } = data;

  return (
    <section className="py-12 sm:py-16" aria-labelledby="category-name">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl rounded-xl border border-border bg-background px-6 py-10 sm:px-8 sm:py-12 text-center">
          <h1 id="category-name" className="text-base sm:text-lg font-semibold text-foreground">
            {category.name}
          </h1>
          {category.description && (
            <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
              {category.description}
            </p>
          )}

          <div className="mt-6 w-full max-w-md mx-auto rounded-lg border border-border bg-muted/40 p-4 text-left">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Current highest bid</dt>
                <dd className="font-semibold text-foreground">
                  {highestBid ? formatAmount(highestBid.amount) : 'No bids yet'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Starting bid</dt>
                <dd className="font-medium text-foreground">
                  {formatAmount(category.starting_bid)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Bid increment</dt>
                <dd className="font-medium text-foreground">{formatAmount(category.increment)}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-6 flex w-full flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link
              href="/#leaderboard-heading"
              className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
            >
              View Leaderboard
            </Link>
            <Link
              href="/"
              className="inline-flex w-full sm:w-auto items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11"
            >
              Browse categories
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
