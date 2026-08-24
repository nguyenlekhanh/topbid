import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listAllBidsForAdmin } from './admin-bid-management';

/**
 * Task 8.4 - deterministic tests for the read-only bid management view.
 * Authorization and service-role boundaries are mocked; the real column-selection,
 * ordering/limit, and privacy-mapping logic runs.
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

beforeEach(() => {
  mocks.getAdminAuthorization.mockReset();
  mocks.getAdminAuthorization.mockResolvedValue({ authorized: true, userId: 'admin-1' });
  mocks.state.queue.length = 0;
  mocks.state.calls.length = 0;
});

describe('listAllBidsForAdmin', () => {
  it('fails closed for non-admins without touching the database', async () => {
    mocks.getAdminAuthorization.mockResolvedValue({ authorized: false });

    await expect(listAllBidsForAdmin()).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('selects only display-safe columns and embeds the category name', async () => {
    enqueue({
      data: [
        {
          created_at: '2026-02-01T00:00:00Z',
          amount: 125000,
          status: 'paid',
          bidder_name: 'Winner',
          paid_at: '2026-02-01T00:05:00Z',
          categories: { name: 'Art & Collectibles' },
        },
      ],
      error: null,
    });

    const result = await listAllBidsForAdmin();

    expect(result.ok).toBe(true);

    const selectCall = mocks.state.calls.find((call) => call.method === 'select');
    const columns = selectCall?.args[0] as string;

    // Allowed display columns present:
    expect(columns).toContain('created_at');
    expect(columns).toContain('amount');
    expect(columns).toContain('status');
    expect(columns).toContain('bidder_name');
    expect(columns).toContain('paid_at');
    expect(columns).toContain('categories ( name )');

    // Sensitive columns absent at the query level:
    const selectedColumns = columns.split(',').map((column) => column.trim());
    expect(selectedColumns).not.toContain('bidder_email');
    expect(selectedColumns).not.toContain('stripe_session_id');
    expect(selectedColumns).not.toContain('stripe_payment_intent_id');
    expect(selectedColumns).not.toContain('id');
  });

  it('orders newest-first within a bounded window of 100 rows', async () => {
    enqueue({ data: [], error: null });

    await listAllBidsForAdmin();

    const orderCalls = mocks.state.calls.filter((call) => call.method === 'order');
    expect(orderCalls[0]?.args).toEqual(['created_at', { ascending: false }]);
    expect(mocks.state.calls.find((call) => call.method === 'limit')?.args).toEqual([100]);
  });

  it('maps rows to the allow-listed view model, stripping any extra database fields', async () => {
    enqueue({
      data: [
        {
          created_at: '2026-02-01T00:00:00Z',
          amount: 150000,
          status: 'pending',
          bidder_name: 'Challenger',
          paid_at: null,
          categories: { name: 'Retro Gaming' },
          // Over-provisioned row: real queries cannot return these (column selection),
          // but the mapping must strip them even if it ever happened.
          bidder_email: 'challenger@example.com',
          stripe_session_id: 'cs_secret_123',
          stripe_payment_intent_id: 'pi_secret_456',
          id: 'internal-bid-id',
        },
      ],
      error: null,
    });

    const result = await listAllBidsForAdmin();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.bids).toEqual([
        {
          categoryName: 'Retro Gaming',
          bidderName: 'Challenger',
          amountCents: 150000,
          status: 'pending',
          createdAt: '2026-02-01T00:00:00Z',
          paidAt: null,
        },
      ]);

      const serialized = JSON.stringify(result.bids);
      expect(serialized).not.toContain('challenger@example.com');
      expect(serialized).not.toContain('cs_secret_123');
      expect(serialized).not.toContain('pi_secret_456');
      expect(serialized).not.toContain('internal-bid-id');
    }
  });

  it('surfaces all four authoritative statuses without inventing new ones', async () => {
    const statuses = ['pending', 'paid', 'failed', 'refunded'];

    enqueue({
      data: statuses.map((status, index) => ({
        created_at: `2026-02-0${index + 1}T00:00:00Z`,
        amount: 1000 + index,
        status,
        bidder_name: null,
        paid_at: null,
        categories: null,
      })),
      error: null,
    });

    const result = await listAllBidsForAdmin();

    expect(result.ok && result.bids.map((bid) => bid.status)).toEqual(statuses);
    expect(result.ok && result.bids[2].categoryName).toBeNull();
  });

  it('propagates database failures as db_error without leaking internals', async () => {
    enqueue({ data: null, error: { message: 'permission denied for table bids' } });

    const result = await listAllBidsForAdmin();

    expect(result).toEqual({ ok: false, reason: 'db_error' });
  });
});
