import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRateLimiters } from '@/lib/rate-limit';
import { POST as unsubscribePost } from './route';

/**
 * Task 9.11 - deterministic error-handling coverage for the public unsubscribe
 * endpoint (previously the only externally reachable boundary without a suite).
 *
 * The storage mutation is mocked at the unsubscribe-module boundary while the REAL
 * token shape validation runs, so the route's exact failure semantics are pinned:
 * rate-limited 429 before any processing, malformed bodies/tokens redirected without
 * touching storage, and GET deliberately absent so email-scanner link prefetching can
 * never mutate suppression state (Task 6.6).
 */

const mocks = vi.hoisted(() => ({
  unsubscribeByToken: vi.fn(),
}));

vi.mock('@/lib/unsubscribe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/unsubscribe')>();

  return {
    ...actual,
    unsubscribeByToken: mocks.unsubscribeByToken,
  };
});

const VALID_TOKEN = 'a'.repeat(64);

beforeEach(() => {
  resetRateLimiters();
  mocks.unsubscribeByToken.mockReset();
  mocks.unsubscribeByToken.mockResolvedValue('unsubscribed');
});

describe('POST /api/unsubscribe', () => {
  it('processes a valid query token and redirects to the confirmation page', async () => {
    const response = await unsubscribePost(
      new Request(`http://localhost/api/unsubscribe?token=${VALID_TOKEN}`, { method: 'POST' })
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `http://localhost/unsubscribe?token=${VALID_TOKEN}&submitted=1`
    );
    expect(mocks.unsubscribeByToken).toHaveBeenCalledWith(VALID_TOKEN);
  });

  it('falls back to the form body token when the query string has none', async () => {
    const response = await unsubscribePost(
      new Request('http://localhost/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: VALID_TOKEN }).toString(),
      })
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `http://localhost/unsubscribe?token=${VALID_TOKEN}&submitted=1`
    );
    expect(mocks.unsubscribeByToken).toHaveBeenCalledWith(VALID_TOKEN);
  });

  it('redirects bare requests without a token and never touches storage', async () => {
    // Empty body: formData parsing fails and is swallowed -> treated as absent token.
    const response = await unsubscribePost(
      new Request('http://localhost/api/unsubscribe', { method: 'POST' })
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/unsubscribe');
    expect(mocks.unsubscribeByToken).not.toHaveBeenCalled();
  });

  it.each(['', 'not-a-token', 'z'.repeat(10)])(
    'rejects malformed token %p without any storage access',
    async (token) => {
      const response = await unsubscribePost(
        new Request(`http://localhost/api/unsubscribe?token=${encodeURIComponent(token)}`, {
          method: 'POST',
        })
      );

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('http://localhost/unsubscribe');
      expect(mocks.unsubscribeByToken).not.toHaveBeenCalled();
    }
  );

  it('rate-limits floods with 429 and Retry-After before any processing', async () => {
    const url = `http://localhost/api/unsubscribe?token=${VALID_TOKEN}`;

    for (let i = 0; i < 10; i += 1) {
      const response = await unsubscribePost(new Request(url, { method: 'POST' }));

      expect(response.status).toBe(303);
    }

    const blocked = await unsubscribePost(new Request(url, { method: 'POST' }));

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });
    expect(blocked.headers.get('Retry-After')).toBe('60');
    expect(mocks.unsubscribeByToken).toHaveBeenCalledTimes(10);
  });

  it('never exposes a GET handler (prefetching must not mutate state)', async () => {
    const route = (await import('./route')) as unknown as Record<string, unknown>;

    expect(route.POST).toBeTypeOf('function');
    expect(route.GET).toBeUndefined();
  });
});
