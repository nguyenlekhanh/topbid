import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { listPaymentsForAdmin, type AdminPaymentStatus } from '@/lib/admin-payment-management';
import { createClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
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

/**
 * Payment management (Task 8.5) - deliberately READ-ONLY.
 *
 * Refund initiation is Task 8.6; until it lands, this view provides the payment
 * oversight half of the capability: authoritative status, amounts, timestamps, and
 * the Stripe identifiers administrators need to cross-reference the Stripe dashboard.
 *
 * Payment state itself changes only through verified webhook transactions
 * (Tasks 4.8-4.11); no admin mutation path exists on this page.
 */
export default async function AdminPaymentsPage() {
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
