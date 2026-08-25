import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initiateAdminRefund } from './admin-refunds';

/**
 * Task 8.6 - deterministic tests for the admin refund action.
 * Stripe and service-role boundaries are mocked; the real ordering, idempotency-key
 * construction, RPC argument construction, and outcome mapping run.
 */

type FakeResult = { data: unknown; error: { message: string } | null };

const mocks = vi.hoisted(() => {
  type CallLog = Array<{ method: string; args: unknown[] }>;
  type FakeState = {
    queue: FakeResult[];
    calls: CallLog;
    getAdminAuthorization: ReturnType<typeof vi.fn>;
    refundsCreate: ReturnType<typeof vi.fn>;
  };

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

  const state = {
    queue: [] as FakeResult[],
    calls: [] as CallLog,
    getAdminAuthorization: vi.fn(),
    getAdminContext: vi.fn(),
    refundsCreate: vi.fn(),
    writeAuditLog: vi.fn(),
  };

  return { makeFakeClient, state };
});

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => mocks.makeFakeClient(mocks.state),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    refunds: {
      create: mocks.state.refundsCreate,
    },
  },
}));

vi.mock('@/lib/admin-auth', () => ({
  getAdminContext: mocks.state.getAdminContext,
  getAdminAuthorization: mocks.state.getAdminAuthorization,
}));
vi.mock('@/lib/audit-log', () => ({
  writeAuditLog: mocks.state.writeAuditLog,
}));

const BID_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function enqueue(...results: FakeResult[]) {
  mocks.state.queue.push(...results);
}

beforeEach(() => {
  mocks.state.getAdminContext.mockReset();
  mocks.state.getAdminContext.mockResolvedValue({
    authorized: true,
    userId: 'admin-1',
    email: 'admin@topbid.lol',
  });
  mocks.state.refundsCreate.mockReset();
  mocks.state.refundsCreate.mockResolvedValue({ id: 're_test_1', status: 'succeeded' });
  mocks.state.writeAuditLog.mockReset();
  mocks.state.writeAuditLog.mockResolvedValue(true);
  mocks.state.queue.length = 0;
  mocks.state.calls.length = 0;
});

describe('authorization gate', () => {
  it('fails closed for non-admins without any Stripe or database call', async () => {
    mocks.state.getAdminContext.mockResolvedValue({ authorized: false });

    await expect(initiateAdminRefund({ bidId: BID_ID })).resolves.toEqual({
      ok: false,
      reason: 'unauthorized',
    });

    expect(mocks.state.refundsCreate).not.toHaveBeenCalled();
    expect(mocks.state.calls).toHaveLength(0);
  });
});

describe('input validation', () => {
  it.each([null, undefined, '', 'not-a-uuid', 'x'.repeat(300)])(
    'rejects invalid bid id %p before any lookup',
    async (bidId) => {
      await expect(initiateAdminRefund({ bidId })).resolves.toEqual({
        ok: false,
        reason: 'invalid_bid_id',
      });

      expect(mocks.state.calls).toHaveLength(0);
      expect(mocks.state.refundsCreate).not.toHaveBeenCalled();
    }
  );
});

describe('refundable-state validation', () => {
  it('reports not_found when the bid does not exist', async () => {
    enqueue({ data: null, error: null });

    await expect(initiateAdminRefund({ bidId: BID_ID })).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(mocks.state.refundsCreate).not.toHaveBeenCalled();
  });

  it.each(['pending', 'failed', 'refunded'])(
    'refuses to refund a %s bid through Stripe',
    async (status) => {
      enqueue({
        data: { status, amount: 100000, stripe_payment_intent_id: 'pi_x' },
        error: null,
      });

      await expect(initiateAdminRefund({ bidId: BID_ID })).resolves.toEqual({
        ok: false,
        reason: 'not_refundable',
      });
      expect(mocks.state.refundsCreate).not.toHaveBeenCalled();
    }
  );

  it('requires a persisted PaymentIntent to issue the Stripe refund', async () => {
    enqueue({
      data: { status: 'paid', amount: 100000, stripe_payment_intent_id: null },
      error: null,
    });

    await expect(initiateAdminRefund({ bidId: BID_ID })).resolves.toEqual({
      ok: false,
      reason: 'missing_payment_intent',
    });
    expect(mocks.state.refundsCreate).not.toHaveBeenCalled();
  });

  it('treats zero-amount rows as not found (nothing to refund)', async () => {
    enqueue({ data: { status: 'paid', amount: 0, stripe_payment_intent_id: 'pi_x' }, error: null });

    await expect(initiateAdminRefund({ bidId: BID_ID })).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(mocks.state.refundsCreate).not.toHaveBeenCalled();
  });
});

describe('Stripe refund execution', () => {
  const paidLookup = {
    data: { status: 'paid', amount: 125000, stripe_payment_intent_id: 'pi_test_123' },
    error: null,
  };

  it('creates the full Stripe refund with a per-bid idempotency key', async () => {
    enqueue(paidLookup);
    enqueue({ data: 'refunded', error: null });

    await initiateAdminRefund({ bidId: BID_ID });

    expect(mocks.state.refundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_test_123' },
      { idempotencyKey: `admin-refund-${BID_ID}` }
    );
  });

  it('applies the authoritative transition with the Stripe refund id after success', async () => {
    enqueue(paidLookup);
    enqueue({ data: 'refunded', error: null });

    const result = await initiateAdminRefund({ bidId: BID_ID });

    expect(result).toEqual({ ok: true, outcome: 'refunded', refundId: 're_test_1' });

    const rpcCall = mocks.state.calls.find((call) => call.method === 'rpc');
    expect(rpcCall?.args[0]).toBe('refund_paid_bid');
    expect(rpcCall?.args[1]).toEqual({
      p_event_id: 're_test_1',
      p_event_type: 'admin.refund',
      p_stripe_payment_intent_id: 'pi_test_123',
    });
  });

  it('never performs direct bid-row mutations for the refund transition', async () => {
    enqueue(paidLookup);
    enqueue({ data: 'refunded', error: null });

    await initiateAdminRefund({ bidId: BID_ID });

    const methods = mocks.state.calls.map((call) => call.method);
    expect(methods).toContain('select');
    expect(methods).toContain('rpc');
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('upsert');
    expect(methods).not.toContain('delete');
  });

  it('maps provider failures without recording any local refund', async () => {
    enqueue(paidLookup);
    mocks.state.refundsCreate.mockRejectedValue(new Error('card already fully refunded'));

    const result = await initiateAdminRefund({ bidId: BID_ID });

    expect(result).toEqual({ ok: false, reason: 'provider_failed' });
    expect(mocks.state.calls.filter((call) => call.method === 'rpc')).toHaveLength(0);
  });

  it('honestly reports db_pending when the transition fails after provider success', async () => {
    enqueue(paidLookup);
    mocks.state.refundsCreate.mockResolvedValue({ id: 're_test_2', status: 'succeeded' });
    // The rpc call consumes this queued result:
    mocks.state.queue.push({ data: null, error: { message: 'transition failed' } });

    const result = await initiateAdminRefund({ bidId: BID_ID });

    expect(result).toEqual({ ok: false, reason: 'db_pending' });
  });

  it('is retry-safe: duplicate ledger claims resolve as already_refunded', async () => {
    enqueue(paidLookup);
    enqueue({ data: 'duplicate', error: null });

    const result = await initiateAdminRefund({ bidId: BID_ID });

    expect(result).toEqual({
      ok: true,
      outcome: 'already_refunded',
      refundId: 're_test_1',
    });
  });

  it('defers non-terminal Stripe statuses to the charge.refunded webhook', async () => {
    enqueue(paidLookup);
    mocks.state.refundsCreate.mockResolvedValue({ id: 're_pend_1', status: 'pending' });

    const result = await initiateAdminRefund({ bidId: BID_ID });

    expect(result).toEqual({ ok: true, outcome: 'refund_submitted', refundId: 're_pend_1' });
    expect(mocks.state.calls.filter((call) => call.method === 'rpc')).toHaveLength(0);
  });
});

describe('audit discipline (Task 9.11)', () => {
  const paidLookup = {
    data: { status: 'paid', amount: 125000, stripe_payment_intent_id: 'pi_test_123' },
    error: null,
  };

  it('failed refunds never produce audit entries that could read as successes', async () => {
    // Provider failure after passing all pre-validation:
    enqueue(paidLookup);
    mocks.state.refundsCreate.mockRejectedValue(new Error('provider down'));
    await expect(initiateAdminRefund({ bidId: BID_ID })).resolves.toMatchObject({
      ok: false,
      reason: 'provider_failed',
    });

    // Restore a succeeding provider for the post-provider-success scenarios below.
    mocks.state.refundsCreate.mockResolvedValue({ id: 're_test_2', status: 'succeeded' });

    // DB transition failure AFTER provider success (db_pending):
    enqueue(paidLookup);
    enqueue({ data: null, error: { message: 'transition failed' } });
    await expect(initiateAdminRefund({ bidId: BID_ID })).resolves.toMatchObject({
      ok: false,
      reason: 'db_pending',
    });

    // Unexpected RPC outcome:
    enqueue(paidLookup);
    enqueue({ data: 'invalid_state', error: null });
    await expect(initiateAdminRefund({ bidId: BID_ID })).resolves.toMatchObject({
      ok: false,
      reason: 'db_pending',
    });

    expect(mocks.state.writeAuditLog).not.toHaveBeenCalled();
  });

  it('business-rule refusals write no audit entries', async () => {
    for (const setup of [
      function missingBid() {
        enqueue({ data: null, error: null });
      },
      function notPaid() {
        enqueue({
          data: { status: 'pending', amount: 100000, stripe_payment_intent_id: 'pi_x' },
          error: null,
        });
      },
      function missingPi() {
        enqueue({
          data: { status: 'paid', amount: 100000, stripe_payment_intent_id: null },
          error: null,
        });
      },
    ]) {
      setup();
      await initiateAdminRefund({ bidId: BID_ID });
    }

    mocks.state.getAdminContext.mockResolvedValueOnce({ authorized: false });
    await initiateAdminRefund({ bidId: BID_ID });

    expect(mocks.state.writeAuditLog).not.toHaveBeenCalled();
  });

  it.each([
    ['refunded', { outcome: 'refunded', stripe_refund_id: 're_test_1' }],
    ['duplicate', { outcome: 'duplicate', stripe_refund_id: 're_test_1' }],
    ['already_refunded', { outcome: 'already_refunded', stripe_refund_id: 're_test_1' }],
  ])(
    'successful/no-op transitions audit exactly once with outcome %s',
    async (rpcOutcome, expectedDetail) => {
      enqueue(paidLookup);
      enqueue({ data: rpcOutcome, error: null });

      await expect(initiateAdminRefund({ bidId: BID_ID })).resolves.toMatchObject({
        ok: true,
        outcome: rpcOutcome === 'refunded' ? 'refunded' : 'already_refunded',
      });

      expect(mocks.state.writeAuditLog).toHaveBeenCalledTimes(1);
      expect(mocks.state.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payment.refund',
          targetType: 'bid',
          targetId: BID_ID,
          actorUserId: 'admin-1',
          detail: expectedDetail,
        })
      );
    }
  );

  it('refund_submitted is audited as a submission, never as a completed refund', async () => {
    enqueue(paidLookup);
    mocks.state.refundsCreate.mockResolvedValue({ id: 're_pend_2', status: 'pending' });

    await initiateAdminRefund({ bidId: BID_ID });

    expect(mocks.state.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.state.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment.refund',
        detail: { outcome: 'refund_submitted', stripe_refund_id: 're_pend_2' },
      })
    );
  });
});
