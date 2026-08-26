import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * UI redesign follow-up - /api/products/resolve route tests.
 *
 * Contract: preview-only endpoint. No Stripe, no database mutation, no bid creation -
 * enforced here by asserting the authoritative modules are never imported/used.
 */

const mocks = vi.hoisted(() => ({
  resolveProductPreview: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPendingBid: vi.fn(),
  createServiceClient: vi.fn(),
  check: vi.fn(),
}));

vi.mock('@/lib/product-resolver', () => ({
  resolveProductPreview: mocks.resolveProductPreview,
}));

vi.mock('@/lib/checkout', () => ({
  createCheckoutSession: mocks.createCheckoutSession,
}));

vi.mock('@/lib/bids', () => ({
  createPendingBid: mocks.createPendingBid,
}));

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: mocks.createServiceClient,
}));

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '198.51.100.7',
  RATE_LIMIT_RULES: { productResolve: { limit: 30, windowMs: 60_000 } },
  rateLimiters: { productResolve: { check: mocks.check } },
}));

import { POST } from './route';

const PREVIEW = {
  sourceUrl: 'https://voxylio.lndev.me',
  canonicalUrl: 'https://voxylio.lndev.me',
  title: 'Voxylio',
  description: 'Real-time dubbing.',
  imageUrl: 'https://voxylio.lndev.me/og.png',
  faviconUrl: 'https://voxylio.lndev.me/favicon.ico',
  siteName: 'Voxylio',
};

function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/products/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  mocks.check.mockReset();
  mocks.check.mockReturnValue({ allowed: true, remaining: 29 });
  mocks.resolveProductPreview.mockReset();
  mocks.createCheckoutSession.mockReset();
  mocks.createPendingBid.mockReset();
  mocks.createServiceClient.mockReset();
});

describe('POST /api/products/resolve (UI redesign follow-up)', () => {
  it('returns normalized preview metadata for a valid URL', async () => {
    mocks.resolveProductPreview.mockResolvedValue({ ok: true, preview: PREVIEW });

    const response = await post({ input: 'https://voxylio.lndev.me' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preview: PREVIEW });
    expect(mocks.resolveProductPreview).toHaveBeenCalledWith('https://voxylio.lndev.me');
  });

  it.each([
    [undefined, 'invalid_input'],
    [{}, 'invalid_input'],
    [{ input: '' }, 'invalid_input'],
    [{ input: '@myhandle' }, 'unsupported_handle'],
    [{ input: 'http://169.254.169.254/latest' }, 'unsafe_url'],
    [{ input: 'https://gone.example.com/x' }, 'not_found'],
    [{ input: 'https://pdf.example.com/doc.pdf' }, 'not_html'],
  ])('maps failure %j to its stable error reason', async (input, expectedError) => {
    const status = expectedError === 'not_found' ? 404 : expectedError === 'not_html' ? 422 : 400;
    mocks.resolveProductPreview.mockResolvedValue({
      ok: false,
      reason: expectedError as never,
    });

    const response = await post({ input });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: expectedError });
  });

  it('rate limits floods with 429 before resolving', async () => {
    let calls = 0;
    mocks.check.mockImplementation(() => {
      calls += 1;
      return calls <= 30 ? { allowed: true, remaining: 30 - calls } : { allowed: false };
    });
    mocks.resolveProductPreview.mockResolvedValue({ ok: true, preview: PREVIEW });

    for (let i = 0; i < 30; i++) {
      await post({ input: 'https://example.com' });
    }

    const blocked = await post({ input: 'https://example.com' });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
    expect(mocks.resolveProductPreview).toHaveBeenCalledTimes(30);
  });

  it('NEVER invokes Stripe checkout, bid creation, or service-role DB access', async () => {
    mocks.resolveProductPreview.mockResolvedValue({ ok: true, preview: PREVIEW });

    await post({
      input: 'https://example.com',
      amount: 999999,
      email: 'x@y.com',
      categorySlug: 'art',
    });

    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.createPendingBid).not.toHaveBeenCalled();
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('resolver throws surface as generic 500 without internals', async () => {
    mocks.resolveProductPreview.mockRejectedValue(new Error('internal stack trace xyz'));

    const response = await post({ input: 'https://example.com' });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('xyz');
  });
});
