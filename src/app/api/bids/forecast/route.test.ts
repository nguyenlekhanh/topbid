import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * UI redesign follow-up - /api/bids/forecast route tests.
 * Read-only informational feed: never touches Stripe or mutates anything.
 */

const mocks = vi.hoisted(() => ({
  getBidForecast: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPendingBid: vi.fn(),
  check: vi.fn(),
}));

vi.mock('@/lib/bid-forecast', () => ({
  getBidForecast: mocks.getBidForecast,
}));

vi.mock('@/lib/checkout', () => ({
  createCheckoutSession: mocks.createCheckoutSession,
}));

vi.mock('@/lib/bids', () => ({
  createPendingBid: mocks.createPendingBid,
}));

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '198.51.100.7',
  RATE_LIMIT_RULES: { bidForecast: { limit: 60, windowMs: 60_000 } },
  rateLimiters: { bidForecast: { check: mocks.check } },
}));

import { GET } from './route';

function get(category?: string): Promise<Response> {
  const url = new URL('http://localhost/api/bids/forecast');

  if (category) {
    url.searchParams.set('category', category);
  }

  return GET(new Request(url));
}

beforeEach(() => {
  mocks.check.mockReset();
  mocks.check.mockReturnValue({ allowed: true, remaining: 59 });
  mocks.getBidForecast.mockReset();
});

describe('GET /api/bids/forecast (UI redesign follow-up)', () => {
  it('returns the derived forecast for the global board', async () => {
    mocks.getBidForecast.mockResolvedValue({
      nextAmountCents: 900,
      projectedRank: 1,
      totalPaidBids: 3,
      currentTopCents: 800,
    });

    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({
      forecast: {
        nextAmountCents: 900,
        projectedRank: 1,
        totalPaidBids: 3,
        currentTopCents: 800,
      },
    });
    expect(mocks.getBidForecast).toHaveBeenCalledWith({ categorySlug: undefined });
  });

  it('passes an explicit category scope through', async () => {
    mocks.getBidForecast.mockResolvedValue({
      nextAmountCents: 200,
      projectedRank: 4,
      totalPaidBids: 9,
      currentTopCents: 2_500_000,
    });

    await get('art');

    expect(mocks.getBidForecast).toHaveBeenCalledWith({ categorySlug: 'art' });
  });

  it('never invokes Stripe checkout or bid creation (read-only feed)', async () => {
    mocks.getBidForecast.mockResolvedValue({
      nextAmountCents: 100,
      projectedRank: 1,
      totalPaidBids: 0,
      currentTopCents: null,
    });

    await get();

    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.createPendingBid).not.toHaveBeenCalled();
  });

  it('rate limits floods with 429 and Retry-After', async () => {
    let calls = 0;
    mocks.check.mockImplementation(() => {
      calls += 1;
      return calls <= 60 ? { allowed: true, remaining: 60 - calls } : { allowed: false };
    });
    mocks.getBidForecast.mockResolvedValue({
      nextAmountCents: 100,
      projectedRank: 1,
      totalPaidBids: 0,
      currentTopCents: null,
    });

    for (let i = 0; i < 60; i++) {
      const ok = await get();
      expect(ok.status).toBe(200);
    }

    const blocked = await get();

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
  });

  it('maps forecast failures to a generic 500 without internals', async () => {
    mocks.getBidForecast.mockRejectedValue(new Error('secret db dsn xyz'));

    const response = await get();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('xyz');
  });
});
