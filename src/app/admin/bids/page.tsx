import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { listAllBidsForAdmin, type AdminBidStatus } from '@/lib/admin-bid-management';
import { createClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
  title: 'Bid management — Topbid.lol',
};

function formatAmount(amountCents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

const STATUS_STYLES: Record<AdminBidStatus, string> = {
  pending: 'bg-warning/10 text-foreground',
  paid: 'bg-success/10 text-foreground',
  failed: 'bg-destructive/10 text-destructive',
  refunded: 'bg-muted text-muted-foreground',
};

/**
 * Bid management (Task 8.4) - deliberately READ-ONLY.
 *
 * Bid status transitions are payment-authoritative state owned exclusively by the
 * verified-webhook RPCs (Tasks 4.8-4.11); no admin mutation path exists here because
 * none can exist without creating an alternate payment pipeline. This page provides
 * operational visibility into every bid status - including pending/failed/refunded
 * rows that public RLS hides - via the isolated server-only read in
 * listAllBidsForAdmin (guarded by the Task 8.1 boundary).
 *
 * Displayed per row: created time, category name, amount, status badge, bidder
 * DISPLAY name only. Never shown: bidder emails, Stripe session/payment-intent ids,
 * internal bid ids, unsubscribe tokens.
 */
export default async function AdminBidsPage() {
  const listing = await listAllBidsForAdmin();

  if (!listing.ok) {
    if (listing.reason === 'unauthorized') {
      redirect('/admin/login');
    }

    redirect('/admin/login');
  }

  const bids = listing.bids;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? 'admin';

  function formatTimestamp(iso: string): string {
    return new Date(iso).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  return (
    <section className="py-12 sm:py-16" aria-label="Bid management">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Bid management</h1>
            <p className="mt-1 text-sm break-all text-muted-foreground">
              Signed in as {email} · latest {bids.length} bid{bids.length === 1 ? '' : 's'}
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Back to dashboard
          </Link>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-background p-5">
          {bids.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground" role="status">
              No bids have been placed yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Placed
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Category
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Bidder
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Amount
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {bids.map((bid) => (
                    <tr key={`${bid.createdAt}-${bid.amountCents}`} className="align-middle">
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {formatTimestamp(bid.createdAt)}
                      </td>
                      <td className="py-2.5 pr-4 text-foreground">
                        {bid.categoryName ?? 'Uncategorized'}
                      </td>
                      <td className="py-2.5 pr-4 text-foreground">{bid.bidderName ?? '—'}</td>
                      <td className="py-2.5 pr-4 font-semibold text-foreground">
                        {formatAmount(bid.amountCents)}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[bid.status]}`}
                        >
                          {bid.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-8 rounded-xl border border-border bg-muted/40 p-5">
          <h2 className="text-base font-semibold text-foreground">Payment state policy</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Bid statuses are owned by verified Stripe webhook events and change only through their
            transactional boundaries — never manually. Pending bids become paid automatically after
            payment confirmation; failures and refunds follow the same authoritative flow.
          </p>
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/admin"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}
