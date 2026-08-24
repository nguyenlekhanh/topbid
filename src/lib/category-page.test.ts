import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCategoryPageData } from './category-page';

/**
 * Task 7.4 — deterministic tests for the public category page loader.
 * Queue-based fake Supabase boundary keeps the real query logic in play; no database.
 */

type FakeResult = { data: unknown; error: { message: string } | null };

const mocks = vi.hoisted(() => {
  type CallLog = Array<{ method: string; args: unknown[] }>;
  type FakeState = { queue: FakeResult[]; calls: CallLog };

  function makeFakeBuilder(state: FakeState) {
    const builder: unknown = new Proxy(
      {},
      {
        get(_target: unknown, property: string | symbol) {
          if (typeof property !== 'string') {
            return undefined;
          }
          if (property === 'then') {
            return (resolve: (value: FakeResult) => void) => {
              void Promise.resolve().then(() => {
                resolve(state.queue.shift() ?? { data: null, error: null });
              });
            };
          }
          return (...args: unknown[]) => {
            state.calls.push({ method: property, args });
            return builder;
          };
        },
      }
    );
    return builder;
  }

  function makeFakeClient(state: FakeState) {
    const client: unknown = new Proxy(
      {},
      {
        get(_target: unknown, property: string | symbol) {
          if (typeof property !== 'string') {
            return undefined;
          }
          if (property === 'then') {
            return undefined;
          }
          return (...args: unknown[]) => {
            state.calls.push({ method: property, args });
            return makeFakeBuilder(state);
          };
        },
      }
    );
    return client;
  }

  const serverState: FakeState = { queue: [], calls: [] };

  return { makeFakeClient, serverState };
});

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => mocks.makeFakeClient(mocks.serverState),
}));

const CATEGORY_ROW = {
  id: 'cat-1',
  slug: 'art',
  name: 'Art & Collectibles',
  description: 'Rare artwork and collectibles.',
  starting_bid: 50000,
  increment: 5000,
  image_url: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const HIGHEST_BID_ROW = {
  id: 'bid-1',
  category_id: 'cat-1',
  amount: 125000,
  bidder_email: 'winner@example.com',
  bidder_name: 'Winner',
  stripe_session_id: 'cs_test_abc',
  stripe_payment_intent_id: null,
  status: 'paid',
  is_highest: true,
  created_at: '2026-02-01T00:00:00Z',
  paid_at: '2026-02-01T00:00:00Z',
};

function enqueue(...results: FakeResult[]) {
  mocks.serverState.queue.push(...results);
}

beforeEach(() => {
  mocks.serverState.queue.length = 0;
  mocks.serverState.calls.length = 0;
});

describe('loadCategoryPageData', () => {
  it('resolves an active category with its current highest paid bid', async () => {
    enqueue({ data: CATEGORY_ROW, error: null }, { data: HIGHEST_BID_ROW, error: null });

    const result = await loadCategoryPageData('art');

    expect(result).toEqual({ category: CATEGORY_ROW, highestBid: HIGHEST_BID_ROW });

    // The lookup uses the authoritative slug query (normalized, active-only).
    const eqCall = mocks.serverState.calls.find((call) => call.method === 'eq');
    expect(eqCall?.args).toEqual(['slug', 'art']);
  });

  it('returns a null highest bid for a category with no paid bids yet', async () => {
    enqueue({ data: CATEGORY_ROW, error: null }, { data: null, error: null });

    const result = await loadCategoryPageData('art');

    expect(result).toEqual({ category: CATEGORY_ROW, highestBid: null });
  });

  it('collapses nonexistent slugs into the not-found outcome', async () => {
    enqueue({ data: null, error: null });

    await expect(loadCategoryPageData('does-not-exist')).resolves.toBeNull();
  });

  it('never exposes inactive categories', async () => {
    // getCategoryBySlug enforces is_active = true (app filter + RLS); an inactive
    // category is indistinguishable from a missing one.
    enqueue({ data: null, error: null });

    await expect(loadCategoryPageData('retired-category')).resolves.toBeNull();
  });

  it.each([null as unknown as string, undefined as unknown as string, '', '   '])(
    'rejects malformed slug %p without querying',
    async (slug) => {
      await expect(loadCategoryPageData(slug)).resolves.toBeNull();
      expect(mocks.serverState.calls).toHaveLength(0);
    }
  );

  it('propagates category lookup failures descriptively', async () => {
    enqueue({ data: null, error: { message: 'database unavailable' } });

    await expect(loadCategoryPageData('art')).rejects.toThrow(
      'Failed to fetch category "art": database unavailable'
    );
  });

  it('propagates highest-bid lookup failures descriptively', async () => {
    enqueue(
      { data: CATEGORY_ROW, error: null },
      { data: null, error: { message: 'database unavailable' } }
    );

    await expect(loadCategoryPageData('art')).rejects.toThrow(/Failed to fetch highest bid/);
  });

  it('normalizes uppercase/whitespace slugs through the authoritative query', async () => {
    enqueue({ data: CATEGORY_ROW, error: null }, { data: null, error: null });

    await loadCategoryPageData('  ART ');

    const eqCall = mocks.serverState.calls.find((call) => call.method === 'eq');
    expect(eqCall?.args).toEqual(['slug', 'art']);
  });
});
