import { describe, expect, it, vi } from 'vitest';

import { isNonEmptyProductInput, submitBid } from './bid-submit';

/**
 * UI redesign task - bid submit pipeline tests.
 * The payload contract contains NO amount field and NO email; failures map, never throw.
 */

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('submitBid (UI redesign task)', () => {
  it('posts ONLY product + optional categorySlug to the checkout endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ url: 'https://stripe/x' }));

    const outcome = await submitBid(
      { product: ' https://example.com/product/my-product ', categorySlug: 'art' },
      fetchImpl as unknown as typeof fetch
    );

    expect(outcome).toEqual({ ok: true, url: 'https://stripe/x' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/bids/checkout');
    const sent = JSON.parse(String(init.body));
    expect(sent.product).toBe('https://example.com/product/my-product');
    expect(sent.categorySlug).toBe('art');
    expect(JSON.stringify(init.body)).not.toContain('amount');
    expect(JSON.stringify(init.body)).not.toContain('email');
  });

  it('omits categorySlug entirely when unselected (server picks the leader)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ url: 'u' }));

    await submitBid({ product: '@myhandle', categorySlug: null }, fetchImpl as typeof fetch);

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      product: '@myhandle',
    });
  });

  it.each(['', '   '])(
    'rejects empty product %p locally without any network call',
    async (product) => {
      const fetchImpl = vi.fn();

      await expect(submitBid({ product }, fetchImpl as unknown as typeof fetch)).resolves.toEqual({
        ok: false,
        error: 'invalid_product',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it('passes @handle and URL forms through verbatim - the SERVER validates deeply', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ url: 'u' }));

    await submitBid({ product: '@MyHandle' }, fetchImpl as typeof fetch);
    await submitBid({ product: 'javascript:alert(1)' }, fetchImpl as unknown as typeof fetch);

    expect(
      (JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as { product: string }).product
    ).toBe('@MyHandle');
    // Deep rejection (scheme/hostname/handle charset) is server-side; client only
    // gates on emptiness.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps server failure reasons to a failed outcome with minimum echo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'amount_below_minimum', minimumBid: 5000 }), {
        status: 400,
      })
    );

    await expect(submitBid({ product: '@h' }, fetchImpl as typeof fetch)).resolves.toEqual({
      ok: false,
      error: 'amount_below_minimum',
      minimumBid: 5000,
    });
  });

  it('swallows network failures as network_failed instead of throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(submitBid({ product: '@h' }, fetchImpl as typeof fetch)).resolves.toEqual({
      ok: false,
      error: 'network_failed',
    });
  });

  it('treats non-JSON error pages as generic checkout failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    await expect(submitBid({ product: '@h' }, fetchImpl as typeof fetch)).resolves.toEqual({
      ok: false,
      error: 'checkout_failed',
      minimumBid: null,
    });
  });

  it('empty-input gate accepts realistic handles/urls for transport', () => {
    expect(isNonEmptyProductInput(' @myhandle ')).toBe(true);
    expect(isNonEmptyProductInput('https://example.com/p')).toBe(true);
    expect(isNonEmptyProductInput('   ')).toBe(false);
  });
});
