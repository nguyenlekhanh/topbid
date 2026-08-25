import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * UI redesign task - authoritative next-bid derivation tests.
 *
 * BUSINESS RULE: nextBid = current maximum + $1 (100 cents); $1 when empty.
 * The browser never supplies a price. No starting-bid/increment fallback may exist.
 */

const mocks = vi.hoisted(() => {
  const state = {
    validateCategory: vi.fn(),
    bidsBuilder: null as Record<string, unknown> | null,
    categoriesResult: {
      data: [] as Array<Record<string, unknown>>,
      error: null as null | { message: string },
    },
  };

  function makeBidsBuilder(rows: Array<Record<string, unknown>>) {
    const builder = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      in() {
        // status IN (paid, pending) - reservations occupy the floor like the RPC.
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
    };
    state.bidsBuilder = builder;
    return builder;
  }

  function makeCategoriesBuilder() {
    const builder = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      order() {
        return Promise.resolve(state.categoriesResult);
      },
    };
    return builder;
  }

  return { state, makeBidsBuilder, makeCategoriesBuilder };
});

vi.mock('@/lib/categories', () => ({
  validateCategory: mocks.state.validateCategory,
  listCategories: () => Promise.resolve(mocks.state.categoriesResult.data),
}));
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: async () => ({
    from(table: string) {
      return table === 'bids' ? mocks.state.bidsBuilder : mocks.makeCategoriesBuilder();
    },
  }),
}));
import { resolveNextBid } from './next-bid';

beforeEach(() => {
  mocks.state.validateCategory.mockReset();
  mocks.state.bidsBuilder = null;
  mocks.state.categoriesResult = { data: [], error: null };
});

const PAID_ROW = (amountCents: number) => [
  { id: 'bid-top', amount: amountCents, category_id: 'cat-1' },
];

describe('resolveNextBid - category selected', () => {
  it('category maximum $100 -> $101 (max + $1)', async () => {
    mocks.state.validateCategory.mockResolvedValue({
      valid: true,
      category: { id: 'cat-1', slug: 'art', name: 'Art' },
    });
    mocks.makeBidsBuilder(PAID_ROW(10_000));

    await expect(resolveNextBid({ categorySlug: 'art' })).resolves.toEqual({
      ok: true,
      categorySlug: 'art',
      categoryId: 'cat-1',
      categoryName: 'Art',
      amount: 10_100, // $101
    });
  });

  it('category with NO paid bid -> exactly $1 (no starting-bid fallback)', async () => {
    mocks.state.validateCategory.mockResolvedValue({
      valid: true,
      category: { id: 'cat-2', slug: 'tech', name: 'Tech' },
    });
    mocks.makeBidsBuilder([]);

    await expect(resolveNextBid({ categorySlug: 'tech' })).resolves.toMatchObject({
      ok: true,
      amount: 100, // $1
    });
  });

  it('unknown/inactive slug errors instead of re-targeting another category', async () => {
    mocks.state.validateCategory.mockResolvedValue({
      valid: false,
      reason: 'category_not_found',
      category: null,
    });

    await expect(resolveNextBid({ categorySlug: 'ghost' })).resolves.toEqual({
      ok: false,
      reason: 'category_not_found',
    });
    expect(mocks.state.bidsBuilder).toBeNull();
  });
});

describe('resolveNextBid - no category selected (global leader)', () => {
  it('global maximum $250 -> $251 on the leading category', async () => {
    mocks.makeBidsBuilder([
      {
        id: 'bid-g',
        amount: 25_000,
        category_id: 'cat-b',
        categories: { slug: 'catb', name: 'Category B' },
      },
    ]);

    await expect(resolveNextBid({})).resolves.toEqual({
      ok: true,
      categorySlug: 'catb',
      categoryId: 'cat-b',
      categoryName: 'Category B',
      amount: 25_100, // $251
    });
  });

  it('no reservations anywhere -> $1 on the first active category', async () => {
    mocks.makeBidsBuilder([]);
    mocks.state.categoriesResult = {
      data: [
        { id: 'c1', slug: 'art', name: 'Art' },
        { id: 'c2', slug: 'tech', name: 'Tech' },
      ],
      error: null,
    };

    await expect(resolveNextBid({})).resolves.toEqual({
      ok: true,
      categorySlug: 'art',
      categoryId: 'c1',
      categoryName: 'Art',
      amount: 100, // $1
    });
  });

  it('a PENDING reservation occupies the floor exactly like a paid bid', async () => {
    // Mirrors the live dev database: one pending $500 art checkout awaiting webhook.
    mocks.makeBidsBuilder([
      {
        id: 'bid-pending',
        amount: 50_000,
        category_id: 'cat-art',
        categories: { slug: 'art', name: 'Art' },
      },
    ]);

    await expect(resolveNextBid({})).resolves.toMatchObject({ amount: 50_100 }); // $501
  });

  it('fails honestly when no active categories exist at all', async () => {
    mocks.makeBidsBuilder([]);
    mocks.state.categoriesResult = { data: [], error: null };

    await expect(resolveNextBid({})).resolves.toEqual({
      ok: false,
      reason: 'no_active_categories',
    });
  });
});
