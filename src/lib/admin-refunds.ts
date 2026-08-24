import { createServiceClient } from '@/lib/supabase-service';
import { getAdminContext } from '@/lib/admin-auth';
import { writeAuditLog } from '@/lib/audit-log';
import { stripe } from '@/lib/stripe';

/**
 * Admin-initiated refund action (Task 8.6).
 *
 * Safe order of operations (payment-authority preserved):
 * 1. getAdminAuthorization() - fail closed before ANY privileged call
 * 2. Authoritative bid lookup by id (service role): status must be 'paid', a Stripe
 *    PaymentIntent id must exist (persisted by Task 4.8), and amount must be > 0
 * 3. stripe.refunds.create({ payment_intent }, { idempotencyKey: admin-refund-<bidId> })
 *    through the EXISTING server-only Stripe client - the idempotency key makes
 *    double-clicks and HTTP retries resolve to the SAME Stripe refund instead of
 *    creating a second one or erroring inconsistently
 * 4. refund_paid_bid RPC (the Task 4.11 authoritative transition: ledger claim +
 *    row-locked paid->refunded inside one transaction) invoked with event_id =
 *    Stripe refund id and event_type 'admin.refund'. When the matching charge.refunded
 *    webhook arrives later it resolves to already_refunded/duplicate no-ops - the
 *    processed_webhook_events ledger stays intact and no parallel state machine exists.
 * 5. Typed result; a non-terminal Stripe status skips step 4 and reports
 *    'refund_submitted' - the charge.refunded webhook finalizes state authoritatively.
 *
 * Failure semantics:
 * - Provider failure -> reason 'provider_failed'; NO local refund is recorded (money
 *   has not moved) and it is never reported as success
 * - RPC failure AFTER a successful provider refund -> reason 'db_pending': money HAS
 *   moved, so this is honestly surfaced as retry-safe (the Stripe idempotency key +
 *   ledger duplicate no-op converge) rather than silently claimed as failed/success
 */

export type AdminRefundOutcome = 'refunded' | 'already_refunded' | 'refund_submitted';

export type AdminRefundResult =
  | { ok: true; outcome: AdminRefundOutcome; refundId?: string }
  | {
      ok: false;
      reason:
        | 'unauthorized'
        | 'invalid_bid_id'
        | 'not_found'
        | 'not_refundable'
        | 'missing_payment_intent'
        | 'provider_failed'
        | 'db_pending';
    };

function normalizeBidId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

type RefundableBid = {
  status: string;
  amount: number;
  stripe_payment_intent_id: string | null;
};

async function applyRefundTransition(
  context: { userId: string; email: string },
  bidId: string,
  paymentIntentId: string,
  refundId: string
): Promise<AdminRefundResult> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('refund_paid_bid', {
    p_event_id: refundId,
    p_event_type: 'admin.refund',
    p_stripe_payment_intent_id: paymentIntentId,
  });

  if (error) {
    // Money has already been refunded on Stripe's side; the webhook will reconcile.
    console.error(
      '[admin-refunds] refund transition failed after provider success',
      JSON.stringify({ refundId, message: error.message })
    );

    return { ok: false, reason: 'db_pending' };
  }

  const outcome = data as string;

  if (outcome === 'refunded') {
    await writeAuditLog({
      actorUserId: context.userId,
      actorEmail: context.email,
      action: 'payment.refund',
      targetType: 'bid',
      targetId: bidId,
      detail: { outcome: 'refunded', stripe_refund_id: refundId },
    });

    return { ok: true, outcome: 'refunded', refundId };
  }

  if (outcome === 'already_refunded' || outcome === 'duplicate') {
    // Idempotent no-op: the refund was already applied (webhook raced ahead, or this
    // exact action was retried). Audited as the same no-op it is.
    await writeAuditLog({
      actorUserId: context.userId,
      actorEmail: context.email,
      action: 'payment.refund',
      targetType: 'bid',
      targetId: bidId,
      detail: { outcome, stripe_refund_id: refundId },
    });

    return { ok: true, outcome: 'already_refunded', refundId };
  }

  console.error('[admin-refunds] unexpected transition outcome', JSON.stringify({ outcome }));

  return { ok: false, reason: 'db_pending' };
}

export async function initiateAdminRefund(input: { bidId: unknown }): Promise<AdminRefundResult> {
  const context = await getAdminContext();

  if (!context.authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const bidId = normalizeBidId(input.bidId);

  if (!bidId) {
    return { ok: false, reason: 'invalid_bid_id' };
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('bids')
    .select('status, amount, stripe_payment_intent_id')
    .eq('id', bidId)
    .maybeSingle();

  if (error) {
    console.error('[admin-refunds] bid lookup failed:', error.message);

    return { ok: false, reason: 'not_found' };
  }

  const bid = data as RefundableBid | null;

  if (!bid || typeof bid.amount !== 'number' || bid.amount <= 0) {
    return { ok: false, reason: 'not_found' };
  }

  if (bid.status !== 'paid') {
    return { ok: false, reason: 'not_refundable' };
  }

  const paymentIntentId = bid.stripe_payment_intent_id;

  if (!paymentIntentId || !paymentIntentId.trim()) {
    return { ok: false, reason: 'missing_payment_intent' };
  }

  let refund: { id?: string; status?: string };

  try {
    const created = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `admin-refund-${bidId}` }
    );

    refund = { id: created.id, status: created.status ?? undefined };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    console.error('[admin-refunds] Stripe refund failed:', JSON.stringify({ message }));

    return { ok: false, reason: 'provider_failed' };
  }

  const refundId = refund.id;

  if (!refundId) {
    console.error('[admin-refunds] Stripe returned no refund id');

    return { ok: false, reason: 'provider_failed' };
  }

  if (refund.status && refund.status !== 'succeeded') {
    // Non-terminal (e.g. pending): the charge.refunded webhook finalizes state via
    // the authoritative RPC - do not mark refunded locally on a guess.
    console.warn(
      '[admin-refunds] Stripe refund submitted but not yet succeeded',
      JSON.stringify({ bidId, refundId, status: refund.status })
    );

    await writeAuditLog({
      actorUserId: context.userId,
      actorEmail: context.email,
      action: 'payment.refund',
      targetType: 'bid',
      targetId: bidId,
      detail: { outcome: 'refund_submitted', stripe_refund_id: refundId },
    });

    return { ok: true, outcome: 'refund_submitted', refundId };
  }

  const transition = await applyRefundTransition(context, bidId, paymentIntentId, refundId);

  return transition;
}
