import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * UI redesign task - checkout route tests.
 * Security-critical assertions: a client-supplied amount is IGNORED (server derives it
 * from the database), the product identifier is validated/normalized server-side, and
 * the synthetic bidder address never carries user PII.
 */

const mocks = vi.hoisted(() => ({
  resolveNextBid: vi.fn(),
  createCheckoutSession: vi.fn(),
  check: vi.fn(),
}));

vi.mock('@/lib/next-bid', () => ({
  resolveNextBid: mocks.resolveNextBid,
}));

vi.mock('@/lib/checkout', () => ({
  createCheckoutSession: mocks.createCheckoutSession,
}));

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '203.0.113.9',
  RATE_LIMIT_RULES: { bidCheckout: { limit: 10, windowMs: 60_000 } },
  rateLimiters: {
    bidCheckout: {
      check: mocks.check,
    },
  },
}));

import { POST } from './route';

async function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/bids/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  mocks.check.mockReset();
  mocks.check.mockReturnValue({ allowed: true, remaining: 9 });
  mocks.resolveNextBid.mockReset();
  mocks.createCheckoutSession.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/bids/checkout (UI redesign task)', () => {
  it('valid URL + category: derives the amount server-side; client amount ignored', async () => {
    mocks.resolveNextBid.mockResolvedValue({
      ok: true,
      categorySlug: 'art',
      categoryId: 'cat-1',
      categoryName: 'Art',
      amount: 10_100, // $101 = $100 max + $1
    });
    mocks.createCheckoutSession.mockResolvedValue({
      valid: true,
      url: 'https://checkout.stripe.com/pay/x',
      stripeSessionId: 'cs_1',
    });

    const response = await post({
      email: 'should-be-ignored@evil.com',
      categorySlug: 'art',
      product: 'https://example.com/product/my-product',
      amount: 1, // hostile/garbage client price - must never reach checkout
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://checkout.stripe.com/pay/x',
      sessionId: 'cs_1',
    });
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
      categorySlug: 'art',
      amount: 10_100,
      bidderEmail: expect.stringMatching(/^noreply\+[0-9a-f]{16}@topbid\.lol$/),
      bidderName: 'https://example.com/product/my-product',
    });
  });

  it('normalizes a valid @handle (lowercased) and creates the session', async () => {
    mocks.resolveNextBid.mockResolvedValue({
      ok: true,
      categorySlug: 'tech',
      categoryId: 'cat-2',
      categoryName: '',
      amount: 100, // empty category -> $1
    });
    mocks.createCheckoutSession.mockResolvedValue({
      valid: true,
      url: 'https://checkout.stripe.com/pay/y',
      stripeSessionId: 'cs_2',
    });

    const response = await post({ product: '@MyHandle', categorySlug: 'tech' });

    expect(response.status).toBe(200);
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ bidderName: '@myhandle', amount: 100 })
    );
  });

  it.each([
    ['javascript:alert(1)'],
    ['not a url'],
    ['ftp://example.com/file'],
    ['https://user:pass@example.com/x'],
    ['@'],
    ['@has space'],
    [null],
    [123],
    [undefined],
  ])('rejects invalid product input %p with 400 before any derivation', async (product) => {
    const body = product === undefined ? {} : { product };

    const response = await post(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_product' });
    expect(mocks.resolveNextBid).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('no-category requests derive from the GLOBAL maximum (resolver receives no slug)', async () => {
    mocks.resolveNextBid.mockResolvedValue({
      ok: true,
      categorySlug: 'leader',
      categoryId: 'cat-l',
      categoryName: 'Leader',
      amount: 25_100, // $251 = $250 global max + $1
    });
    mocks.createCheckoutSession.mockResolvedValue({
      valid: true,
      url: 'u',
      stripeSessionId: 'cs_l',
    });

    await post({ product: '@global' });

    expect(mocks.resolveNextBid).toHaveBeenCalledWith({});
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 25_100 })
    );
  });

  it('empty database derivation ($1) flows straight through to checkout', async () => {
    mocks.resolveNextBid.mockResolvedValue({
      ok: true,
      categorySlug: 'crypto',
      categoryId: 'cat-c',
      categoryName: '',
      amount: 100,
    });
    mocks.createCheckoutSession.mockResolvedValue({
      valid: true,
      url: 'u',
      stripeSessionId: 'cs_c',
    });

    await post({ product: '@first' });

    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100 })
    );
  });

  it('maps category_not_found to 400 and no_active_categories to 503', async () => {
    mocks.resolveNextBid.mockResolvedValue({ ok: false, reason: 'category_not_found' });
    expect((await post({ product: '@h', categorySlug: 'ghost' })).status).toBe(400);

    mocks.resolveNextBid.mockResolvedValue({ ok: false, reason: 'no_active_categories' });
    expect((await post({ product: '@h' })).status).toBe(503);
  });

  it.each([
    ['banned_email', 400],
    ['amount_below_minimum', 400],
    ['duplicate_transaction', 409],
  ])('maps checkout failure %s to HTTP %i without leaking details', async (reason, status) => {
    mocks.resolveNextBid.mockResolvedValue({
      ok: true,
      categorySlug: 'art',
      categoryId: 'cat-1',
      categoryName: '',
      amount: 1000,
    });
    mocks.createCheckoutSession.mockResolvedValue({
      valid: false,
      reason,
      minimumBid: 2000,
    });

    const response = await post({ product: '@h' });

    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).toBe(reason);
  });

  it('returns generic 500 on unexpected failures without provider detail', async () => {
    mocks.resolveNextBid.mockImplementation(() => {
      throw new Error('secret database connection string xyz');
    });

    const response = await post({ product: '@h' });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('xyz');
  });

  it('rate limits floods with 429 before any derivation', async () => {
    mocks.resolveNextBid.mockResolvedValue({
      ok: true,
      categorySlug: 'art',
      categoryId: 'cat-1',
      categoryName: '',
      amount: 1000,
    });
    mocks.createCheckoutSession.mockResolvedValue({
      valid: true,
      url: 'u',
      stripeSessionId: 'cs',
    });

    let calls = 0;
    mocks.check.mockImplementation(() => {
      calls += 1;
      return calls <= 10 ? { allowed: true, remaining: 10 - calls } : { allowed: false };
    });

    for (let i = 0; i < 10; i++) {
      const ok = await post({ product: '@h' });
      expect(ok.status).toBe(200);
    }

    const blocked = await post({ product: '@h' });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
    expect(mocks.createCheckoutSession).toHaveBeenCalledTimes(10);
  });

  it('serves POST only', async () => {
    const route = (await import('./route')) as unknown as Record<string, unknown>;

    expect(route.POST).toBeTypeOf('function');
    expect(route.GET).toBeUndefined();
  });
});
