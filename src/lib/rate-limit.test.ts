import { describe, expect, it } from 'vitest';

import { createRateLimiter, RATE_LIMIT_RULES } from './rate-limit';

/**
 * Task 9.2 — deterministic tests for the fixed-window rate limiter.
 * Time is injected; no real waiting, network, or external services.
 */

describe('createRateLimiter', () => {
  it('allows requests below the limit and reports remaining count', () => {
    const limiter = createRateLimiter();

    expect(limiter.check('ip-1', { limit: 3, windowMs: 60_000 }, 1000)).toEqual({
      allowed: true,
      remaining: 2,
    });
    expect(limiter.check('ip-1', { limit: 3, windowMs: 60_000 }, 1001)).toEqual({
      allowed: true,
      remaining: 1,
    });
  });

  it('blocks the request that exceeds the limit with a retry delay', () => {
    const limiter = createRateLimiter();
    const rule = { limit: 2, windowMs: 60_000 };

    expect(limiter.check('ip-1', rule, 1000).allowed).toBe(true);
    expect(limiter.check('ip-1', rule, 2000).allowed).toBe(true);

    const third = limiter.check('ip-1', rule, 3000);
    expect(third.allowed).toBe(false);
    expect(!third.allowed && third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps identities isolated from each other', () => {
    const limiter = createRateLimiter();
    const rule = { limit: 1, windowMs: 60_000 };

    expect(limiter.check('ip-a', rule, 1000)).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.check('ip-b', rule, 1000)).toEqual({ allowed: true, remaining: 0 });
  });

  it('opens a fresh window after the previous one expires (injected clock)', () => {
    const limiter = createRateLimiter();
    const rule = { limit: 1, windowMs: 60_000 };

    expect(limiter.check('ip-1', rule, 10_000).allowed).toBe(true);
    expect(limiter.check('ip-1', rule, 10_001).allowed).toBe(false);

    // One millisecond past the window boundary the identity is allowed again.
    expect(limiter.check('ip-1', rule, 70_000).allowed).toBe(true);
  });

  it('tracks windows per identity independently over time', () => {
    const limiter = createRateLimiter();
    const rule = { limit: 1, windowMs: 60_000 };

    expect(limiter.check('ip-a', rule, 10_000).allowed).toBe(true);
    expect(limiter.check('ip-b', rule, 20_000).allowed).toBe(true);
    expect(limiter.check('ip-a', rule, 30_000).allowed).toBe(false);
    expect(limiter.check('ip-b', rule, 40_000).allowed).toBe(false);
  });

  it('supports multiple independent rules through one shared instance', () => {
    const limiter = createRateLimiter();

    expect(limiter.check('k', RATE_LIMIT_RULES.adminLogin, 1000).allowed).toBe(true);
    expect(limiter.check('k', RATE_LIMIT_RULES.shareEvents, 1000).allowed).toBe(true);
  });
});

describe('RATE_LIMIT_RULES', () => {
  it('pins the documented per-endpoint limits/windows', () => {
    expect(RATE_LIMIT_RULES.adminLogin).toEqual({ limit: 10, windowMs: 600_000 });
    expect(RATE_LIMIT_RULES.shareEvents).toEqual({ limit: 30, windowMs: 60_000 });
    expect(RATE_LIMIT_RULES.unsubscribe).toEqual({ limit: 10, windowMs: 60_000 });
    expect(RATE_LIMIT_RULES.refund).toEqual({ limit: 20, windowMs: 3_600_000 });
  });
});
