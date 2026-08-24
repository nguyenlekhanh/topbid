import { createClient } from '@/lib/supabase';

/**
 * Client-side realtime subscription for authoritative bid changes (Task 5.1).
 *
 * - Runs in the browser via the existing supabase.ts anon client: deliveries are
 *   filtered by RLS (bids_public_select_paid), so subscribers only ever observe PAID
 *   bids - the same authoritative state the leaderboard/recent-bids queries return
 *   (Tasks 2.8-2.10). No second state machine, no service-role access.
 * - Requires migration 20260823000014 (bids added to the supabase_realtime publication).
 * - The row shape is declared structurally here instead of importing ./bids: bids.ts
 *   pulls in server-only modules (service-role Stripe/Supabase paths) that must never
 *   enter the browser bundle.
 *
 * Task 5.7 - connection/reconnection handling:
 * - The underlying supabase-js socket reconnects automatically; this wrapper translates
 *   the raw channel statuses into a deduplicated connected/disconnected signal:
 *     CHANNEL_ERROR / TIMED_OUT / CLOSED -> 'disconnected' (once per outage)
 *     SUBSCRIBED after such an outage    -> 'connected'   (recovery)
 * - The initial SUBSCRIBED does not emit anything: consumers already fetch initial data
 *   themselves, so only genuine RECOVERIES trigger a resync.
 * - Repeated errors while already disconnected do not re-emit 'disconnected'.
 */

export type RealtimeBidRow = {
  id: string;
  category_id: string;
  amount: number;
  bidder_email: string;
  bidder_name: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  status: string;
  is_highest: boolean | null;
  created_at: string;
  paid_at: string | null;
};

export type BidChangeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export type BidChangePayload = {
  eventType: BidChangeEventType;
  new: RealtimeBidRow | null;
  old: RealtimeBidRow | null;
};

export type RealtimeConnectionStatus = 'connected' | 'disconnected';

export function subscribeToBidChanges(
  onChange: (payload: BidChangePayload) => void,
  onStatusChange?: (status: RealtimeConnectionStatus) => void
): () => void {
  const supabase = createClient();

  let hasDisconnected = false;

  const channel = supabase
    .channel('bids-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bids' },
      (payload: {
        eventType: BidChangeEventType;
        new: Record<string, unknown> | null;
        old: Record<string, unknown> | null;
      }) => {
        onChange({
          eventType: payload.eventType,
          new: (payload.new as RealtimeBidRow) ?? null,
          old: (payload.old as RealtimeBidRow) ?? null,
        });
      }
    )
    .subscribe((status) => {
      switch (status) {
        case 'CHANNEL_ERROR':
        case 'TIMED_OUT':
        case 'CLOSED':
          // Emit once per outage, not for every repeated failure while down.
          if (!hasDisconnected) {
            hasDisconnected = true;

            console.error(`[realtime] bids channel problem: ${status}`);
            onStatusChange?.('disconnected');
          }
          break;
        case 'SUBSCRIBED':
          // Recovery: the channel re-joined after a known outage.
          if (hasDisconnected) {
            hasDisconnected = false;

            onStatusChange?.('connected');
          }
          break;
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
