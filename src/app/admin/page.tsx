import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAdminAuthorization } from '@/lib/admin-auth';
import { loadAdminOverview, type AdminOverview } from '@/lib/admin-dashboard';
import { createClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
  title: 'Admin dashboard — Topbid.lol',
};

function formatAmount(amountCents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground" role="status">
      {children}
    </p>
  );
}

/**
 * Admin dashboard (Task 8.2).
 *
 * - Authorization reuses the Task 8.1 server-side boundary (getAdminAuthorization):
 *   unauthenticated/unauthorized visitors are redirected BEFORE any data is loaded or
 *   rendered - enforcement, not UI hiding
 * - Data comes from the existing RLS-safe queries via loadAdminOverview; the view
 *   model contains no emails/Stripe identifiers/internal ids by construction
 * - Deliberately minimal: overview stats + read-only summaries only. Management
 *   functionality belongs to Tasks 8.3+; future sections are identified without
 *   pretending unfinished functionality exists
 */
export default async function AdminDashboardPage() {
  const authorization = await getAdminAuthorization();

  if (!authorization.authorized) {
    redirect('/admin/login');
  }

  let overview: AdminOverview;

  try {
    overview = await loadAdminOverview();
  } catch {
    // Raw database errors are never rendered to users.
    redirect('/admin/login');
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? 'admin';

  return (
    <section className="py-12 sm:py-16" aria-label="Admin dashboard">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Admin dashboard</h1>
            <p className="mt-1 text-sm break-all text-muted-foreground">Signed in as {email}</p>
          </div>
          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Sign out
            </button>
          </form>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Active categories" value={String(overview.activeCategoryCount)} />
          <StatCard
            label="Top bid overall"
            value={
              overview.topBids.length > 0 ? formatAmount(overview.topBids[0].amountCents) : '—'
            }
          />
          <StatCard label="Recent paid bids" value={`Last ${overview.recentBids.length}`} />
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-background p-5">
            <h2 className="text-base font-semibold text-foreground">Top bids</h2>
            {overview.topBids.length === 0 ? (
              <EmptyNote>No paid bids yet.</EmptyNote>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {overview.topBids.map((bid) => (
                  <li
                    key={`${bid.rank}-${bid.amountCents}`}
                    className="flex justify-between py-2.5 text-sm"
                  >
                    <span className="text-foreground">
                      <span className="font-medium text-muted-foreground">#{bid.rank}</span>{' '}
                      {bid.categoryName ?? 'Uncategorized'}
                    </span>
                    <span className="font-semibold text-foreground">
                      {formatAmount(bid.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-border bg-background p-5">
            <h2 className="text-base font-semibold text-foreground">Recent paid bids</h2>
            {overview.recentBids.length === 0 ? (
              <EmptyNote>No paid bids yet.</EmptyNote>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {overview.recentBids.map((bid) => (
                  <li key={bid.createdAt} className="flex justify-between py-2.5 text-sm">
                    <span className="text-foreground">{bid.categoryName ?? 'Uncategorized'}</span>
                    <span className="font-semibold text-foreground">
                      {formatAmount(bid.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-10 rounded-xl border border-border bg-muted/40 p-5">
          <h2 className="text-base font-semibold text-foreground">Management sections</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>
              <Link
                href="/admin/categories"
                className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
              >
                Category management
              </Link>
            </li>
            <li>
              <Link
                href="/admin/bids"
                className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
              >
                Bid management
              </Link>
            </li>
            <li>
              <Link
                href="/admin/payments"
                className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
              >
                Payment management
              </Link>
            </li>
          </ul>
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
          >
            Back to Topbid.lol
          </Link>
        </div>
      </div>
    </section>
  );
}
