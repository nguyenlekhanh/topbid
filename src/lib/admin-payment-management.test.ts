import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listPaymentsForAdmin } from './admin-payment-management';

/**
 * Task 8.5 — deterministic tests for the read-only payment management view.
 * Authorization and service-role boundaries are mocked; the real column-selection,
 * privacy mapping, ordering/limit, and count aggregation run.
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
    return new Proxy(
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
  }

  const state = { queue: [] as FakeResult[], calls: [] as CallLog };
  const getAdminAuthorization = vi.fn();

  return { makeFakeClient, state, getAdminAuthorization };
});

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => mocks.makeFakeClient(mocks.state),
}));

vi.mock('@/lib/admin-auth', () => ({
  getAdminAuthorization: mocks.getAdminAuthorization,
}));

function enqueue(...results: FakeResult[]) {
  mocks.state.queue.push(...results);
}

const FULL_ROW = {
  created_at: '2026-02-01T00:00:00Z',
  amount: 125000,
  status: 'paid',
  paid_at: '2026-02-01T00:05:00Z',
  stripe_session_id: 'cs_test_abc',
  stripe_payment_intent_id: 'pi_test_123',
  categories: { name: 'Art & Collectibles' },
};

beforeEach(() => {
  mocks.getAdminAuthorization.mockReset();
  mocks.getAdminAuthorization.mockResolvedValue({ authorized: true, userId: 'admin-1' });
  mocks.state.queue.length = 0;
  mocks.state.calls.length = 0;
});

describe('listPaymentsForAdmin', () => {
  it('fails closed for non-admins without touching the database', async () => {
    mocks.getAdminAuthorization.mockResolvedValue({ authorized: false });

    await expect(listPaymentsForAdmin()).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('selects payment columns (incl. Stripe ids) while excluding personal/bid fields', async () => {
    enqueue({ data: [FULL_ROW], error: null });

    await listPaymentsForAdmin();

    const selectCall = mocks.state.calls.find((call) => call.method === 'select');
    const selectedColumns = (selectCall?.args[0] as string)
      .split(',')
      .map((column) => column.trim());

    // Payment-management identifiers are explicitly required by this task:
    expect(selectedColumns).toContain('stripe_session_id');
    expect(selectedColumns).toContain('stripe_payment_intent_id');

    // Personal / non-payment fields are excluded at the query level:
    expect(selectedColumns).not.toContain('bidder_email');
    expect(selectedColumns).not.toContain('bidder_name');
    expect(selectedColumns).not.toContain('id');
  });

  it('orders newest-first within the bounded 100-record window', async () => {
    enqueue({ data: [], error: null });

    await listPaymentsForAdmin();

    const orderCalls = mocks.state.calls.filter((call) => call.method === 'order');
    expect(orderCalls[0]?.args).toEqual(['created_at', { ascending: false }]);
    expect(mocks.state.calls.find((call) => call.method === 'limit')?.args).toEqual([100]);
  });

  it('maps rows through the allow-list, keeping payment ids but stripping personal fields', async () => {
    enqueue({
      data: [
        {
          ...FULL_ROW,
          // Over-provisioned response: must be stripped even if ever returned.
          bidder_email: 'winner@example.com',
          bidder_name: 'Winner',
          id: 'internal-bid-id',
        },
      ],
      error: null,
    });

    const result = await listPaymentsForAdmin();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.overview.payments).toEqual([
        {
          categoryName: 'Art & Collectibles',
          amountCents: 125000,
          status: 'paid',
          stripeSessionId: 'cs_test_abc',
          stripePaymentIntentId: 'pi_test_123',
          createdAt: '2026-02-01T00:00:00Z',
          paidAt: '2026-02-01T00:05:00Z',
        },
      ]);

      const serialized = JSON.stringify(result.overview.payments);
      expect(serialized).not.toContain('winner@example.com');
      expect(serialized).not.toContain('"Winner"');
      expect(serialized).not.toContain('internal-bid-id');
    }
  });

  it('aggregates per-status counts across the read window', async () => {
    enqueue({
      data: [
        { ...FULL_ROW, status: 'paid' },
        { ...FULL_ROW, status: 'paid' },
        { ...FULL_ROW, status: 'refunded', stripe_payment_intent_id: 'pi_r' },
        { ...FULL_ROW, status: 'pending', paid_at: null },
        { ...FULL_ROW, status: 'failed', paid_at: null },
      ],
      error: null,
    });

    const result = await listPaymentsForAdmin();

    expect(result.ok && result.overview.counts).toEqual({
      pending: 1,
      paid: 2,
      failed: 1,
      refunded: 1,
    });
  });

  it('reports empty windows with zeroed counts', async () => {
    enqueue({ data: [], error: null });

    const result = await listPaymentsForAdmin();

    expect(result.ok && result.overview.payments).toEqual([]);
    expect(result.ok && result.overview.counts).toEqual({
      pending: 0,
      paid: 0,
      failed: 0,
      refunded: 0,
    });
  });

  it('propagates database failures as db_error without leaking internals', async () => {
    enqueue({ data: null, error: { message: 'permission denied for table bids' } });

    const result = await listPaymentsForAdmin();

    expect(result).toEqual({ ok: false, reason: 'db_error' });
  });

  it('is a pure read: no mutation methods are ever invoked on the client', async () => {
    enqueue({ data: [FULL_ROW], error: null });

    await listPaymentsForAdmin();

    const mutatingMethods = mocks.state.calls.filter((call) =>
      ['insert', 'update', 'upsert', 'delete'].includes(call.method)
    );

    expect(mutatingMethods).toHaveLength(0);
  });
});
