import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * UI redesign follow-up - position-forecast derivation tests.
 *
 * The forecast is informational only and must be derived deterministically from the
 * SAME paid/pending data and +$1 floor rules the checkout RPC enforces.
 */

type Row = { amount: number };

const supabaseMock = vi.hoisted(() => {
  const state = {
    // Each entry describes one `from('bids')` read, consumed strictly in order:
    //   ['paid', rows]    -> returns rows
    //   ['pending', rows] -> returns rows
    script: [] as Array<{ kind: 'paid' | 'pending'; rows: Row[] }>,
  };

  function builder(rows: Row[]) {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      in: () => b,
      maybeSingle() {
        const top = rows.length ? rows[0].amount : null;
        return Promise.resolve({ data: top === null ? null : { amount: top }, error: null });
      },
      then(resolve: (value: { data: Row[]; error: null }) => void) {
        resolve({ data: rows, error: null });
      },
    };
    return b;
  }

  return {
    state,
    from(table: string) {
      void table;
      const step = state.script.shift();
      const rows = step ? step.rows : [];
      return builder(rows);
    },
  };
});

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    from: (table: string) => supabaseMock.from(table),
  }),
}));

vi.mock('@/lib/categories', () => ({
  validateCategory: async (slug: unknown) =>
    typeof slug === 'string' && slug === 'art'
      ? { valid: true, category: { id: 'cat-art', slug: 'art', name: 'Art' } }
      : { valid: false, reason: 'category_not_found', category: null },
}));

import { getBidForecast } from './bid-forecast';

beforeEach(() => {
  supabaseMock.state.script = [];
});

describe('getBidForecast (informational preview)', () => {
  it('empty board -> $1, projected #1 of 0', async () => {
    supabaseMock.state.script = [
      { kind: 'paid', rows: [] }, // global
    ];

    await expect(getBidForecast({})).resolves.toEqual({
      nextAmountCents: 100,
      projectedRank: 1,
      totalPaidBids: 0,
      currentTopCents: null,
    });
  });

  it('global max $8 -> $9; rank counts only strictly higher amounts', async () => {
    supabaseMock.state.script = [
      { kind: 'pending', rows: [] },
      { kind: 'paid', rows: [{ amount: 800 }, { amount: 700 }, { amount: 600 }] },
    ];

    const f = await getBidForecast({});

    expect(f.nextAmountCents).toBe(900);
    expect(f.projectedRank).toBe(1);
    expect(f.totalPaidBids).toBe(3);
    expect(f.currentTopCents).toBe(800);
  });

  it('a higher bid in another category pushes the projection down', async () => {
    // Reads for a scoped forecast, in order: pending(scoped) -> paid(global) -> paid(scoped)
    supabaseMock.state.script = [
      { kind: 'pending', rows: [] },
      { kind: 'paid', rows: [{ amount: 2_500_000 }, { amount: 800 }, { amount: 700 }] },
      { kind: 'paid', rows: [{ amount: 800 }, { amount: 700 }] },
    ];

    const f = await getBidForecast({ categorySlug: 'art' });

    // scoped floor: $8 + $1 = $9 ; globally, $25k still outranks it
    expect(f.nextAmountCents).toBe(900);
    expect(f.projectedRank).toBe(2);
    expect(f.currentTopCents).toBe(2_500_000);
  });

  it('pending reservations occupy the floor exactly like the checkout RPC', async () => {
    supabaseMock.state.script = [
      { kind: 'pending', rows: [{ amount: 50_000 }] },
      { kind: 'paid', rows: [{ amount: 500 }] },
      { kind: 'paid', rows: [{ amount: 500 }] },
    ];

    const f = await getBidForecast({ categorySlug: 'art' });

    expect(f.nextAmountCents).toBe(50_100); // $501 over the pending $500
  });
});
