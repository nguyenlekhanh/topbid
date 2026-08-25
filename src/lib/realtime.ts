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

type BidChangeHandler = (payload: BidChangePayload) => void;
type StatusHandler = (status: RealtimeConnectionStatus) => void;

/**
 * Task 10.x runtime fix - SHARED CHANNEL WITH REFERENCE-COUNTED FAN-OUT.
 *
 * Current supabase-js REUSES the RealtimeChannel instance for a given topic
 * (RealtimeClient.channel returns the existing channel) and RealtimeChannel.on()
 * THROWS "cannot add postgres_changes callbacks for <topic> after subscribe()" when a
 * callback is attached post-subscribe. The previous implementation called
 * .channel('bids-changes').on(...).subscribe(...) once PER SUBSCRIBER, so the homepage
 * (multiple HighestBidDisplay instances + Leaderboard + RecentBids - all sharing the
 * @supabase/ssr browser-client singleton) crashed on the SECOND subscriber with:
 *   "cannot add `postgres_changes` callbacks for realtime:bids-changes after subscribe()"
 *
 * The fix keeps ONE physical channel per browser client and fans events/statuses out
 * to any number of subscribers:
 * - First subscriber creates the channel, attaches ONE internal postgres_changes
 *   handler, and subscribes.
 * - Additional subscribers only register their handlers (no further .on/.subscribe
 *   calls on the shared channel).
 * - Unsubscribe removes that subscriber's handlers; the LAST one out removes the
 *   channel entirely, so a later resubscribe starts from a fresh instance (React
 *   Strict Mode mount/unmount/mount cycles are therefore safe).
 * - Per-handler invocation is isolated: one throwing consumer can never block others.
 * The public signature/return contract is unchanged.
 */

type SharedBidsChannel = {
  supabase: ReturnType<typeof createClient>;
  channel: unknown;
  handlers: Set<{ onChange: BidChangeHandler; onStatusChange?: StatusHandler }>;
  /**
   * Set when OUR cleanup initiates removeChannel (last subscriber out). Phoenix then
   * fires the channel's close lifecycle, which surfaces as status CLOSED - an EXPECTED
   * transition for self-initiated teardown, not an outage. fanOutStatus consults this
   * flag to stay silent for that case only.
   */
  intentionallyClosed: boolean;
};

const sharedBidsChannels = new WeakMap<object, Map<string, SharedBidsChannel>>();

export function subscribeToBidChanges(
  onChange: BidChangeHandler,
  onStatusChange?: StatusHandler
): () => void {
  const supabase = createClient();

  let byTopic = sharedBidsChannels.get(supabase);

  if (!byTopic) {
    byTopic = new Map<string, SharedBidsChannel>();
    sharedBidsChannels.set(supabase, byTopic);
  }

  const TOPIC = 'bids-changes';
  let shared = byTopic.get(TOPIC);

  if (!shared) {
    const handlers = new Set<{ onChange: BidChangeHandler; onStatusChange?: StatusHandler }>();
    let hasDisconnected = false;

    const fanOutStatus = (status: string): void => {
      // Intentional self-teardown (our own removeChannel) surfaces as CLOSED via the
      // phoenix leave lifecycle. Expected - never an outage signal.
      if (status === 'CLOSED' && shared?.intentionallyClosed) {
        return;
      }

      switch (status) {
        case 'CHANNEL_ERROR':
        case 'TIMED_OUT':
        case 'CLOSED':
          // Emit once per outage, not for every repeated failure while down.
          if (!hasDisconnected) {
            hasDisconnected = true;

            console.error(`[realtime] bids channel problem: ${status}`);

            for (const handler of [...handlers]) {
              try {
                handler.onStatusChange?.('disconnected');
              } catch (error) {
                console.error('[realtime] onStatusChange handler failed', error);
              }
            }
          }
          break;
        case 'SUBSCRIBED':
          // Recovery: the channel re-joined after a known outage.
          if (hasDisconnected) {
            hasDisconnected = false;

            for (const handler of [...handlers]) {
              try {
                handler.onStatusChange?.('connected');
              } catch (error) {
                console.error('[realtime] onStatusChange handler failed', error);
              }
            }
          }
          break;
      }
    };

    const channel = supabase
      .channel(TOPIC)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bids' },
        (payload: {
          eventType: BidChangeEventType;
          new: Record<string, unknown> | null;
          old: Record<string, unknown> | null;
        }) => {
          const normalized: BidChangePayload = {
            eventType: payload.eventType,
            new: (payload.new as RealtimeBidRow) ?? null,
            old: (payload.old as RealtimeBidRow) ?? null,
          };

          for (const handler of [...handlers]) {
            try {
              handler.onChange(normalized);
            } catch (error) {
              console.error('[realtime] onChange handler failed', error);
            }
          }
        }
      )
      .subscribe(fanOutStatus);

    shared = { supabase, channel, handlers, intentionallyClosed: false };
    byTopic.set(TOPIC, shared);
  }

  const entry = { onChange, onStatusChange };

  shared.handlers.add(entry);

  return () => {
    // Re-read from the registry: the shared channel may have been fully torn down and
    // recreated between subscribe and unsubscribe (Strict Mode cycles).
    const current = byTopic.get(TOPIC);

    if (!current || !current.handlers.has(entry)) {
      return;
    }

    current.handlers.delete(entry);

    if (current.handlers.size === 0) {
      byTopic.delete(TOPIC);

      // Mark BEFORE removing: phoenix fires the close lifecycle (status CLOSED) as
      // part of this intentional leave, which fanOutStatus must stay silent about.
      current.intentionallyClosed = true;

      void current.supabase.removeChannel(
        current.channel as Parameters<typeof supabase.removeChannel>[0]
      );
    }
  };
}
