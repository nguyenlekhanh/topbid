import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * UI redesign task - paginated leaderboard query tests (bounded server-side ranges)
 * plus the paid-only / deterministic-ordering contract shared by every leaderboard
 * surface (Home server render + browser pagination).
 */

const supabaseMock = vi.hoisted(() => {
  const state = {
    rangeArgs: [] as Array<[number, number]>,
    eqArgs: [] as Array<[string, unknown]>,
    orderArgs: [] as Array<[string, { ascending: boolean }]>,
    limitArgs: [] as number[],
    result: {
      data: [] as Array<Record<string, unknown>>,
      error: null as null | { message: string },
    },
  };

  function builder() {
    const b = {
      select: () => b,
      eq(column: string, value: unknown) {
        state.eqArgs.push([column, value]);
        return b;
      },
      order(column: string, opts: { ascending: boolean }) {
        state.orderArgs.push([column, opts]);
        return b;
      },
      limit(n: number) {
        state.limitArgs.push(n);
        return b;
      },
      range(offset: number, end: number) {
        state.rangeArgs.push([offset, end]);
        return Promise.resolve(state.result);
      },
    };
    return b;
  }

  return { state, builder };
});

vi.mock('@/lib/supabase', () => ({
  createClient: () => ({ from: () => supabaseMock.builder() }),
}));

// Server-side getLeaderboard (Home page 1) uses the cookie-backed server client:
const serverMock = vi.hoisted(() => {
  const state = {
    eqArgs: [] as Array<[string, unknown]>,
    orderArgs: [] as Array<[string, { ascending: boolean }]>,
    limitArgs: [] as number[],
    result: {
      data: [] as Array<Record<string, unknown>>,
      error: null as null | { message: string },
    },
  };

  function builder() {
    const b = {
      select: () => b,
      eq(column: string, value: unknown) {
        state.eqArgs.push([column, value]);
        return b;
      },
      order(column: string, opts: { ascending: boolean }) {
        state.orderArgs.push([column, opts]);
        return b;
      },
      limit(n: number) {
        state.limitArgs.push(n);
        return b;
      },
      then(resolve: (value: unknown) => void) {
        resolve(state.result);
      },
    };
    return b;
  }

  return { state, builder };
});

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({ from: () => serverMock.builder() }),
}));

import { getLeaderboardPage } from './bids-client';
import { getLeaderboard } from './bids';

beforeEach(() => {
  supabaseMock.state.rangeArgs.length = 0;
  supabaseMock.state.eqArgs.length = 0;
  supabaseMock.state.orderArgs.length = 0;
  supabaseMock.state.limitArgs.length = 0;
  supabaseMock.state.result = { data: [], error: null };
  serverMock.state.eqArgs.length = 0;
  serverMock.state.orderArgs.length = 0;
  serverMock.state.limitArgs.length = 0;
  serverMock.state.result = { data: [], error: null };
});

function row(id: number): Record<string, unknown> {
  return {
    id: `bid-${id}`,
    amount: 1000 + id,
    bidder_name: null,
    created_at: '2026-01-01T00:00:00Z',
    categories: { id: 'c1', slug: 'art', name: 'Art' },
  };
}

describe('getLeaderboardPage (UI redesign task)', () => {
  it('slices a bounded range window for the requested page', async () => {
    supabaseMock.state.result = { data: [row(1), row(2)], error: null };

    const { entries, hasMore } = await getLeaderboardPage(50, 50);

    expect(supabaseMock.state.rangeArgs).toEqual([[50, 99]]);
    expect(entries).toHaveLength(2);
    expect(hasMore).toBe(false);
  });

  it('detects hasMore when a full page plus one extra row arrives', async () => {
    supabaseMock.state.result = {
      data: Array.from({ length: 51 }, (_, i) => row(i)),
      error: null,
    };

    const { entries, hasMore } = await getLeaderboardPage(0, 50);

    expect(entries).toHaveLength(50); // trimmed to page size
    expect(hasMore).toBe(true);
  });

  it('returns entries without any bidder email field', async () => {
    supabaseMock.state.result = { data: [row(1)], error: null };

    const { entries } = await getLeaderboardPage(0, 50);

    expect(entries[0]).not.toHaveProperty('bidderEmail');
    expect(JSON.stringify(entries)).not.toContain('@');
  });

  it('retrieves page 2 with a deterministic non-overlapping range', async () => {
    supabaseMock.state.result = {
      data: Array.from({ length: 50 }, (_, i) => row(100 + i)),
      error: null,
    };

    await getLeaderboardPage(50, 50);

    expect(supabaseMock.state.rangeArgs).toEqual([[50, 99]]);
  });
});

describe('getLeaderboard (Home page 1) - paid-only, deterministic order (Task 10.x)', () => {
  it('filters status=paid (pending bids can never appear) and caps at the page size', async () => {
    serverMock.state.result = { data: [row(1)], error: null };

    const entries = await getLeaderboard({ limit: 50 });

    expect(entries).toHaveLength(1);
    expect(serverMock.state.eqArgs).toContainEqual(['status', 'paid']);
    expect(serverMock.state.limitArgs).toEqual([50]);
  });

  it('orders by amount DESC then created_at DESC (stable tie-breaker)', async () => {
    serverMock.state.result = { data: [row(1)], error: null };

    await getLeaderboard({ limit: 50 });

    expect(serverMock.state.orderArgs).toEqual([
      ['amount', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
  });
});
