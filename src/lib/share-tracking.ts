/**
 * First-party share-event tracking (Task 7.7).
 *
 * The project has no third-party analytics provider; this module is the entire
 * tracking surface - a fire-and-forget POST to the internal /api/share-events
 * endpoint, which persists one row per explicit user share action.
 *
 * Data minimization by construction:
 * - The payload is the event name and nothing else (no URLs, category attribution,
 *   session/payment/bid identifiers, emails, or tokens)
 * - Dispatch never throws and its result is ignored: a failed or blocked tracking
 *   request can never break the Share on X navigation, the clipboard write, or any
 *   page - tracking is pure observability, never authoritative
 *
 * Client-safe module: contains no secrets and imports nothing server-only.
 */

export const SHARE_EVENTS = ['x_share', 'copy_link'] as const;

export type ShareEvent = (typeof SHARE_EVENTS)[number];

export function isShareEvent(value: unknown): value is ShareEvent {
  return typeof value === 'string' && (SHARE_EVENTS as readonly string[]).includes(value);
}

/**
 * Fire-and-forget dispatch. Uses keepalive so an in-flight request survives tab
 * close; every failure mode (network error, non-2xx, unavailable fetch) is swallowed.
 */
export async function trackShareEvent(event: ShareEvent): Promise<void> {
  if (!isShareEvent(event)) {
    return;
  }

  try {
    await fetch('/api/share-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
      keepalive: true,
    });
  } catch {
    // Tracking must never surface errors to users or affect the tracked action.
  }
}
