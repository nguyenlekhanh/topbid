import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { listPaymentsForAdmin, type AdminPaymentStatus } from '@/lib/admin-payment-management';
import { NO_INDEX } from '@/lib/seo';
import { lookupRecordValue } from '@/lib/safe-lookup';
import { createClient } from '@/lib/supabase-server';

// Task 10.5: private admin surface - never indexed.
export const metadata: Metadata = {
  ...NO_INDEX,
  title: 'Payment management — Topbid.lol',
};

function formatAmount(amountCents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

const STATUS_STYLES: Record<AdminPaymentStatus, string> = {
  pending: 'bg-warning/10 text-foreground',
  paid: 'bg-success/10 text-foreground',
  failed: 'bg-destructive/10 text-destructive',
  refunded: 'bg-muted text-muted-foreground',
};

const STATUS_ORDER: AdminPaymentStatus[] = ['paid', 'pending', 'failed', 'refunded'];

const RESULT_MESSAGES: Record<string, string> = {
  refunded: 'Refund completed.',
  already_refunded: 'This payment was already refunded.',
  refund_submitted: 'Refund submitted - Stripe will confirm via webhook shortly.',
};

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'You are not authorized to issue refunds.',
  invalid_bid_id: 'Invalid refund target.',
  not_found: 'The targeted payment no longer exists.',
  not_refundable: 'Only paid payments can be refunded.',
  missing_payment_intent: 'This payment has no Stripe PaymentIntent to refund.',
  provider_failed: 'Stripe rejected the refund. No money has moved - please retry later.',
  db_pending:
    'The refund succeeded on Stripe but local confirmation failed; it will reconcile automatically via webhook. Do not retry immediately.',
};

/**
 * Payment management (Task 8.5) with the admin refund action (Task 8.6) -
 * deliberately READ-ONLY except for refunds.
 *
 * Refunds are initiated server-side: Stripe is refunded FIRST through the existing
 * server-only client (per-bid idempotency key), and bid state changes only through
 * the authoritative Task 4.11 ledger+transition RPC (or the matching charge.refunded
 * webhook). No direct bid-row mutation exists on this surface.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const result = typeof resolvedParams.result === 'string' ? resolvedParams.result : null;
  const error = typeof resolvedParams.error === 'string' ? resolvedParams.error : null;

  const listing = await listPaymentsForAdmin();

  if (!listing.ok) {
    if (listing.reason === 'unauthorized') {
      redirect('/admin/login');
    }

    redirect('/admin/login');
  }

  const { payments, counts } = listing.overview;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? 'admin';

  return (
    <section className="py-12 sm:py-16" aria-label="Payment management">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Payment management</h1>
            <p className="mt-1 text-sm break-all text-muted-foreground">
              Signed in as {email} · latest {payments.length} record
              {payments.length === 1 ? '' : 's'}
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Back to dashboard
          </Link>
        </div>

        {(result || error) && (
          <p
            role="status"
            className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
              error
                ? 'border-destructive/20 bg-destructive/5 text-destructive'
                : 'border-success/20 bg-success/5 text-foreground'
            }`}
          >
            {error
              ? lookupRecordValue(ERROR_MESSAGES, error, 'Something went wrong. Please try again.')
              : lookupRecordValue(RESULT_MESSAGES, result ?? '', 'Done.')}
          </p>
        )}

        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {STATUS_ORDER.map((status) => (
            <div key={status} className="rounded-xl border border-border bg-background p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {status}
              </p>
              <p className="mt-1 text-2xl font-semibold capitalize text-foreground">{status}</p>
              <p className="text-sm text-muted-foreground">{counts[status]} in window</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-border bg-background p-5">
          {payments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground" role="status">
              No payments recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Placed
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Category
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Amount
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Status
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Checkout session
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Payment intent
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Paid at
                    </th>
                    <th scope="col" className="py-2 pl-4 font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.map((payment) => (
                    <tr
                      key={`${payment.createdAt}-${payment.stripeSessionId ?? 'none'}`}
                      className="align-middle"
                    >
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {new Date(payment.createdAt).toLocaleString('en-US', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="py-2.5 pr-4 text-foreground">
                        {payment.categoryName ?? 'Uncategorized'}
                      </td>
                      <td className="py-2.5 pr-4 font-semibold text-foreground">
                        {formatAmount(payment.amountCents)}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[payment.status]}`}
                        >
                          {payment.status}
                        </span>
                      </td>
                      <td className="max-w-[180px] truncate py-2.5 pr-4 font-mono text-xs text-foreground">
                        {payment.stripeSessionId ?? '—'}
                      </td>
                      <td className="max-w-[160px] truncate py-2.5 pr-4 font-mono text-xs text-foreground">
                        {payment.stripePaymentIntentId ?? '—'}
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {payment.paidAt
                          ? new Date(payment.paidAt).toLocaleString('en-US', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                      <td className="py-2.5 pl-4">
                        {payment.status === 'paid' && payment.stripePaymentIntentId ? (
                          <form action="/api/admin/payments/refund" method="post">
                            <input type="hidden" name="bid_id" value={payment.bidId} />
                            <button
                              type="submit"
                              className="inline-flex min-h-11 items-center rounded-lg border border-destructive/40 bg-background px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              Refund
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
