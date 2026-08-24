import { createServiceClient } from '@/lib/supabase-service';

/**
 * Notification delivery state for outbid emails (Task 6.7).
 *
 * One logical outbid notification exists per newly paid bid; the
 * outbid_notification_deliveries row (PRIMARY KEY bid_id) records whether its email
 * actually went out and drives retry decisions at the webhook boundary:
 *
 * - 'pending'           attempt in flight / outcome unknown (safe to retry)
 * - 'sent'              delivered - NEVER resent, no matter how often Stripe
 *                       redelivers the triggering event
 * - 'failed_retryable'  transport-unconfirmed failure - retried on event redelivery
 * - 'failed_permanent'  provider rejected the request - never retried
 *
 * This state is INDEPENDENT of payment idempotency (processed_webhook_events):
 * redelivered events answer 'duplicate' before touching bids while this table alone
 * decides whether the email may be attempted again. Payment and notification are
 * separate idempotency domains.
 *
 * Server-only module: service-role writes to an RLS-locked table (zero policies);
 * must never be imported by client code.
 */

export type DeliveryStatus = 'pending' | 'sent' | 'failed_retryable' | 'failed_permanent';

export type DeliveryAttempt =
  | { status: 'fresh'; attempts: number }
  | { status: 'retry'; attempts: number }
  | { status: 'sent' }
  | { status: 'failed_permanent' };

const DELIVERY_FIELDS = 'bid_id, status, attempts';

/**
 * Begin (or resume) the delivery attempt for a bid.
 *
 * - No row yet -> inserts a 'pending' row (attempts = 1); race-safe via ON CONFLICT
 *   DO NOTHING followed by a re-read so concurrent webhook workers converge
 * - Existing 'pending'/'failed_retryable' -> increments attempts and reports 'retry'
 *   (crash-mid-send rows are safely resumable: outcome was unconfirmed)
 * - Existing 'sent' or 'failed_permanent' -> reports that terminal state so callers
 *   short-circuit without composing or sending anything
 */
export async function beginDeliveryAttempt(bidId: string): Promise<DeliveryAttempt> {
  const supabase = createServiceClient();

  const { data: existing, error: selectError } = await supabase
    .from('outbid_notification_deliveries')
    .select(DELIVERY_FIELDS)
    .eq('bid_id', bidId)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Failed to read delivery state: ${selectError.message}`);
  }

  type Row = { bid_id: string; status: DeliveryStatus; attempts: number };

  const row = existing as Row | null;

  if (!row) {
    const { error: insertError } = await supabase
      .from('outbid_notification_deliveries')
      .upsert(
        { bid_id: bidId, status: 'pending', attempts: 1 },
        { onConflict: 'bid_id', ignoreDuplicates: true }
      );

    if (insertError) {
      throw new Error(`Failed to record delivery attempt: ${insertError.message}`);
    }

    return { status: 'fresh', attempts: 1 };
  }

  if (row.status === 'sent') {
    return { status: 'sent' };
  }

  if (row.status === 'failed_permanent') {
    return { status: 'failed_permanent' };
  }

  const nextAttempts = row.attempts + 1;

  const { error: updateError } = await supabase
    .from('outbid_notification_deliveries')
    .update({ status: 'pending', attempts: nextAttempts, updated_at: new Date().toISOString() })
    .eq('bid_id', bidId);

  if (updateError) {
    throw new Error(`Failed to record delivery retry: ${updateError.message}`);
  }

  return { status: 'retry', attempts: nextAttempts };
}

/** Mark a delivery as sent, persisting the provider message id for observability. */
export async function markDeliverySent(bidId: string, providerMessageId: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('outbid_notification_deliveries')
    .update({
      status: 'sent',
      provider_message_id: providerMessageId,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('bid_id', bidId);

  if (error) {
    throw new Error(`Failed to mark delivery sent: ${error.message}`);
  }
}

/**
 * Mark a failed send with its retry classification. 'failed_retryable' keeps Stripe's
 * redelivery schedule as the retry driver; 'failed_permanent' stops future attempts.
 */
export async function markDeliveryFailed(
  bidId: string,
  status: 'failed_retryable' | 'failed_permanent',
  lastError: string
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('outbid_notification_deliveries')
    .update({ status, last_error: lastError.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('bid_id', bidId);

  if (error) {
    throw new Error(`Failed to mark delivery failed: ${error.message}`);
  }
}
