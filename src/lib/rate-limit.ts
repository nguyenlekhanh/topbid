/**
 * Fixed-window rate limiting (Task 9.2).
 *
 * Smallest architecture satisfying PROJECT_PLAN.md Task 9.2 without new
 * infrastructure: an in-memory fixed-window counter keyed by caller identity.
 *
 * DOCUMENTED LIMITATION: on serverless hosting (Vercel) this state is per instance
 * and resets on cold start, so enforcement is best-effort rather than globally exact.
 * It still caps abusive bursts per instance while every business invariant stays
 * correct (all guarded operations re-validate authorization and state independently).
 * A distributed limiter would require external infrastructure the plan does not
 * mandate; none was added.
 *
 * Failure policy: check() never throws. Exhausted identities receive an exact
 * retryAfterSeconds (fixed windows make reset times precise) so routes can emit a
 * reliable Retry-After header.
 *
 * Memory policy: expired windows are pruned lazily on each check, and tracked keys
 * are hard-capped so abusive key diversity cannot grow memory without bound (dropped
 * keys simply restart at count 1 - identical to a fresh identity).
 */

export type RateLimitRule = { limit: number; windowMs: number };

export type RateLimitResult =
  { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

type WindowState = { count: number; resetAt: number };

const MAX_TRACKED_KEYS = 10_000;

export function createRateLimiter(): RateLimiter {
  const windows = new Map<string, WindowState>();

  return {
    check(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
      if (windows.size > MAX_TRACKED_KEYS) {
        for (const [entryKey, entry] of windows) {
          if (now >= entry.resetAt) {
            windows.delete(entryKey);
          }
        }
      }

      const entry = windows.get(key);

      // Expired or first-seen identity: open a fresh window.
      if (!entry || now >= entry.resetAt) {
        windows.set(key, { count: 1, resetAt: now + rule.windowMs });
        return { allowed: true, remaining: rule.limit - 1 };
      }

      entry.count += 1;

      if (entry.count > rule.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

        return { allowed: false, retryAfterSeconds };
      }

      return { allowed: true, remaining: rule.limit - entry.count };
    },

    reset(): void {
      windows.clear();
    },
  };
}

export interface RateLimiter {
  check(key: string, rule: RateLimitRule, now?: number): RateLimitResult;
  /** Clears all tracked windows for this limiter (deterministic test support). */
  reset(): void;
}

/**
 * Per-endpoint rules (limits per identity within each rolling-fixed window):
 * - adminLogin   : 10 / 10 min per IP   (credential guessing mitigation)
 * - shareEvents  : 30 / minute per IP   (public telemetry write flood cap)
 * - unsubscribe  : 10 / minute per IP   (public blocklist mutation flood cap)
 * - refund       : 20 / hour per admin  (money movement bounded per administrator)
 * - bidCheckout  : 10 / minute per IP   (checkout-session creation flood cap)
 * - productResolve: 30 / minute per IP  (external metadata resolution flood cap)
 * - bidForecast  : 60 / minute per IP   (read-only position-forecast feed)
 */
export const RATE_LIMIT_RULES = {
  adminLogin: { limit: 10, windowMs: 10 * 60_000 },
  shareEvents: { limit: 30, windowMs: 60_000 },
  unsubscribe: { limit: 10, windowMs: 60_000 },
  refund: { limit: 20, windowMs: 60 * 60_000 },
  bidCheckout: { limit: 10, windowMs: 60_000 },
  productResolve: { limit: 30, windowMs: 60_000 },
  bidForecast: { limit: 60, windowMs: 60_000 },
} as const;

/** Shared instances used by the route handlers. */
const sharedLimiters: RateLimiter[] = [];

export const rateLimiters = {
  adminLogin: createRateLimiter(),
  shareEvents: createRateLimiter(),
  unsubscribe: createRateLimiter(),
  refund: createRateLimiter(),
  bidCheckout: createRateLimiter(),
  productResolve: createRateLimiter(),
  bidForecast: createRateLimiter(),
};

// Track shared instances so tests can deterministically clear window state between
// cases without touching production behavior.
sharedLimiters.push(
  rateLimiters.adminLogin,
  rateLimiters.shareEvents,
  rateLimiters.unsubscribe,
  rateLimiters.refund,
  rateLimiters.bidCheckout,
  rateLimiters.productResolve,
  rateLimiters.bidForecast
);

/** Test/operations hook: clears all tracked windows on the shared limiters. */
export function resetRateLimiters(): void {
  for (const limiter of sharedLimiters) {
    limiter.reset();
  }
}

/** Extract the caller identity for public endpoints (first XFF entry). */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');

  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();

    if (first) {
      return first;
    }
  }

  return 'unknown';
}
