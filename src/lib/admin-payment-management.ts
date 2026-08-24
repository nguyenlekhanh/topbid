import { createServiceClient } from '@/lib/supabase-service';
import { getAdminAuthorization } from '@/lib/admin-auth';

/**
 * Server-only payment management read model (Task 8.5).
 *
 * Payment management is deliberately READ-ONLY in this task: PROJECT_PLAN.md places
 * the refund action explicitly in Task 8.6 (dep 8.5), so no mutation exists here -
 * neither direct bid-status writes nor Stripe API initiations. Payment state remains
 * owned exclusively by the verified-webhook RPCs of Tasks 4.8-4.11.
 *
 * What this view adds over Task 8.4's bid list: the AUTHORITATIVE PAYMENT IDENTIFIERS
 * (Stripe Checkout Session id and PaymentIntent id) administrators need to
 * cross-reference the Stripe dashboard, plus per-status counts across the read window.
 *
 * Data minimization: bidder email and bidder display name are excluded entirely
 * (personal fields are irrelevant to payment oversight). Column selection excludes
 * them at the query level AND rows pass through an explicit allow-list mapping.
 *
 * Isolated service-role read behind the Task 8.1 authorization gate (public RLS
 * exposes only paid bids; oversight requires every status), newest-first, bounded
 * window of 100 records.
 */

export type AdminPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type AdminPaymentRow = {
  categoryName: string | null;
  amountCents: number;
  status: AdminPaymentStatus;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type AdminPaymentCounts = Record<AdminPaymentStatus, number>;

export type AdminPaymentsOverview = {
  payments: AdminPaymentRow[];
  counts: AdminPaymentCounts;
};

const EMPTY_COUNTS: AdminPaymentCounts = {
  pending: 0,
  paid: 0,
  failed: 0,
  refunded: 0,
};

const PAYMENT_WINDOW_LIMIT = 100;

const STATUSES: readonly AdminPaymentStatus[] = ['pending', 'paid', 'failed', 'refunded'];

function asStatus(value: string): AdminPaymentStatus {
  return (STATUSES as readonly string[]).includes(value)
    ? (value as AdminPaymentStatus)
    : 'pending';
}

export async function listPaymentsForAdmin(): Promise<
  { ok: true; overview: AdminPaymentsOverview } | { ok: false; reason: 'unauthorized' | 'db_error' }
> {
  if (!(await getAdminAuthorization()).authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('bids')
    .select(
      'created_at, amount, status, paid_at, stripe_session_id, stripe_payment_intent_id, categories ( name )'
    )
    .order('created_at', { ascending: false })
    .limit(PAYMENT_WINDOW_LIMIT);

  if (error) {
    console.error('[admin-payments] list failed:', error.message);

    return { ok: false, reason: 'db_error' };
  }

  type RawRow = {
    created_at: string;
    amount: number;
    status: string;
    paid_at: string | null;
    stripe_session_id: string | null;
    stripe_payment_intent_id: string | null;
    categories: { name: string } | null;
  };

  const counts: AdminPaymentCounts = { ...EMPTY_COUNTS };

  const payments = ((data as unknown as RawRow[]) ?? []).map((row): AdminPaymentRow => {
    const status = asStatus(row.status);

    counts[status] += 1;

    return {
      categoryName: row.categories?.name ?? null,
      amountCents: row.amount,
      status,
      stripeSessionId: row.stripe_session_id,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      createdAt: row.created_at,
      paidAt: row.paid_at,
    };
  });

  return { ok: true, overview: { payments, counts } };
}
