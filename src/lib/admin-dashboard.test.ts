import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAdminOverview } from './admin-dashboard';
import type { Category } from './categories';

/**
 * Task 8.2 — deterministic tests for the admin dashboard overview loader.
 * Query modules are mocked at the module boundary; the real composition/privacy
 * mapping runs. No database or network access.
 */

const CATEGORY: Category = {
  id: 'cat-1',
  slug: 'art',
  name: 'Art & Collectibles',
  description: null,
  starting_bid: 50000,
  increment: 5000,
  image_url: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const queriesMock = vi.hoisted(() => ({
  listCategories: vi.fn(),
  getLeaderboard: vi.fn(),
  getRecentBids: vi.fn(),
}));

vi.mock('@/lib/categories', () => ({
  listCategories: queriesMock.listCategories,
}));

vi.mock('@/lib/bids', () => ({
  getLeaderboard: queriesMock.getLeaderboard,
  getRecentBids: queriesMock.getRecentBids,
}));

const LEADERBOARD_ENTRY = {
  rank: 1,
  bid: {
    id: 'bid-1',
    category_id: 'cat-1',
    amount: 125000,
    bidder_email: 'winner@example.com',
    bidder_name: 'Winner',
    stripe_session_id: 'cs_test_abc',
    stripe_payment_intent_id: 'pi_123',
    status: 'paid',
    is_highest: true,
    created_at: '2026-02-01T00:00:00Z',
    paid_at: '2026-02-01T00:00:00Z',
  },
  category: { id: 'cat-1', slug: 'art', name: 'Art & Collectibles' },
};

const RECENT_BID = {
  bid: LEADERBOARD_ENTRY.bid,
  category: { id: 'cat-1', slug: 'art', name: 'Art & Collectibles' },
};

beforeEach(() => {
  queriesMock.listCategories.mockReset();
  queriesMock.listCategories.mockResolvedValue([CATEGORY]);
  queriesMock.getLeaderboard.mockReset();
  queriesMock.getLeaderboard.mockResolvedValue([LEADERBOARD_ENTRY]);
  queriesMock.getRecentBids.mockReset();
  queriesMock.getRecentBids.mockResolvedValue([RECENT_BID]);
});

describe('loadAdminOverview', () => {
  it('composes active-category count, top bids, and recent bids in parallel', async () => {
    const overview = await loadAdminOverview();

    expect(overview.activeCategoryCount).toBe(1);
    expect(overview.topBids).toEqual([
      { rank: 1, categoryName: 'Art & Collectibles', bidderName: 'Winner', amountCents: 125000 },
    ]);
    expect(overview.recentBids).toEqual([
      {
        bidderName: 'Winner',
        categoryName: 'Art & Collectibles',
        amountCents: 125000,
        createdAt: '2026-02-01T00:00:00Z',
      },
    ]);

    // Existing queries are consumed with the dashboard limit; no new SQL anywhere.
    expect(queriesMock.getLeaderboard).toHaveBeenCalledWith({ limit: 10 });
    expect(queriesMock.getRecentBids).toHaveBeenCalledWith({ limit: 10 });
    expect(queriesMock.listCategories).toHaveBeenCalledTimes(1);
  });

  it('strips bidder emails and all Stripe/internal identifiers from top bids', async () => {
    const overview = await loadAdminOverview();
    const serialized = JSON.stringify(overview);

    expect(serialized).not.toContain('winner@example.com');
    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain('cs_test_abc');
    expect(serialized).not.toContain('pi_123');
    expect(serialized).not.toContain('bid-1');
    expect(serialized).not.toContain('session_id');
    expect(Object.keys(overview.topBids[0]).sort()).toEqual([
      'amountCents',
      'bidderName',
      'categoryName',
      'rank',
    ]);
  });

  it('omits identifiers from recent bids as well', async () => {
    const serialized = JSON.stringify((await loadAdminOverview()).recentBids);

    expect(serialized).not.toContain('winner@example.com');
    expect(serialized).not.toContain('cs_');
    expect(serialized).not.toContain('pi_');
    expect(Object.keys((await loadAdminOverview()).recentBids[0]).sort()).toEqual([
      'amountCents',
      'bidderName',
      'categoryName',
      'createdAt',
    ]);
  });

  it('handles unreadable category names without crashing', async () => {
    queriesMock.getLeaderboard.mockResolvedValue([{ ...LEADERBOARD_ENTRY, category: null }]);
    queriesMock.getRecentBids.mockResolvedValue([{ ...RECENT_BID, category: null }]);

    const overview = await loadAdminOverview();

    expect(overview.topBids[0].categoryName).toBeNull();
    expect(overview.recentBids[0].categoryName).toBeNull();
  });

  it('reports empty collections cleanly (empty-state behavior)', async () => {
    queriesMock.listCategories.mockResolvedValue([]);
    queriesMock.getLeaderboard.mockResolvedValue([]);
    queriesMock.getRecentBids.mockResolvedValue([]);

    const overview = await loadAdminOverview();

    expect(overview).toEqual({
      activeCategoryCount: 0,
      topBids: [],
      recentBids: [],
    });
  });

  it('propagates query failures so the page can render its error state', async () => {
    queriesMock.getLeaderboard.mockRejectedValue(new Error('Failed to fetch leaderboard: down'));

    await expect(loadAdminOverview()).rejects.toThrow('Failed to fetch leaderboard');
  });
});
