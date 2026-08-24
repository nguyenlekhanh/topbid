import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginDeliveryAttempt,
  markDeliveryFailed,
  markDeliverySent,
} from './notification-deliveries';

/**
 * Task 6.7 — deterministic tests for the notification-delivery state boundary.
 * Service-role client faked with the established queue-based proxy; no database.
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

  const state: FakeState = { queue: [], calls: [] };

  return { makeFakeClient, state };
});

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => mocks.makeFakeClient(mocks.state),
}));

function enqueue(...results: FakeResult[]) {
  mocks.state.queue.push(...results);
}

beforeEach(() => {
  mocks.state.queue.length = 0;
  mocks.state.calls.length = 0;
});

describe('beginDeliveryAttempt', () => {
  it('inserts a pending first attempt when no record exists', async () => {
    enqueue({ data: null, error: null }, { data: null, error: null });

    await expect(beginDeliveryAttempt('bid-1')).resolves.toEqual({
      status: 'fresh',
      attempts: 1,
    });

    const upsertCall = mocks.state.calls.find((call) => call.method === 'upsert');
    expect(upsertCall?.args[0]).toEqual({ bid_id: 'bid-1', status: 'pending', attempts: 1 });
    expect(upsertCall?.args[1]).toMatchObject({ onConflict: 'bid_id', ignoreDuplicates: true });
  });

  it('resumes a pending row (crash-mid-send) as a retry with incremented attempts', async () => {
    enqueue(
      { data: { bid_id: 'bid-1', status: 'pending', attempts: 1 }, error: null },
      { data: null, error: null }
    );

    await expect(beginDeliveryAttempt('bid-1')).resolves.toEqual({ status: 'retry', attempts: 2 });

    const updateCall = mocks.state.calls.find((call) => call.method === 'update');
    expect(updateCall?.args[0]).toMatchObject({ status: 'pending', attempts: 2 });
  });

  it('retries failed_retryable rows with incremented attempts', async () => {
    enqueue(
      { data: { bid_id: 'bid-1', status: 'failed_retryable', attempts: 4 }, error: null },
      { data: null, error: null }
    );

    await expect(beginDeliveryAttempt('bid-1')).resolves.toEqual({ status: 'retry', attempts: 5 });
  });

  it.each(['sent', 'failed_permanent'] as const)(
    'short-circuits %p records without any write',
    async (status) => {
      enqueue({ data: { bid_id: 'bid-1', status, attempts: 2 }, error: null });

      await expect(beginDeliveryAttempt('bid-1')).resolves.toEqual({ status });

      expect(mocks.state.calls.filter((call) => call.method === 'upsert')).toHaveLength(0);
      expect(mocks.state.calls.filter((call) => call.method === 'update')).toHaveLength(0);
    }
  );

  it('throws descriptively when reading the record fails', async () => {
    enqueue({ data: null, error: { message: 'database unavailable' } });

    await expect(beginDeliveryAttempt('bid-1')).rejects.toThrow(
      'Failed to read delivery state: database unavailable'
    );
  });

  it('throws descriptively when the fresh insert fails', async () => {
    enqueue({ data: null, error: null }, { data: null, error: { message: 'insert rejected' } });

    await expect(beginDeliveryAttempt('bid-1')).rejects.toThrow(
      'Failed to record delivery attempt: insert rejected'
    );
  });

  it('throws descriptively when the retry update fails', async () => {
    enqueue(
      { data: { bid_id: 'bid-1', status: 'failed_retryable', attempts: 1 }, error: null },
      { data: null, error: { message: 'update rejected' } }
    );

    await expect(beginDeliveryAttempt('bid-1')).rejects.toThrow(
      'Failed to record delivery retry: update rejected'
    );
  });
});

describe('markDeliverySent', () => {
  it('records the sent status and provider message id', async () => {
    enqueue({ data: null, error: null });

    await expect(markDeliverySent('bid-1', 'email-123')).resolves.toBeUndefined();

    const updateCall = mocks.state.calls.find((call) => call.method === 'update');
    expect(updateCall?.args[0]).toMatchObject({
      status: 'sent',
      provider_message_id: 'email-123',
      last_error: null,
    });
    const eqCall = mocks.state.calls.filter((call) => call.method === 'eq').pop();
    expect(eqCall?.args).toEqual(['bid_id', 'bid-1']);
  });

  it('throws descriptively on failure', async () => {
    enqueue({ data: null, error: { message: 'update rejected' } });

    await expect(markDeliverySent('bid-1', 'email-123')).rejects.toThrow(
      'Failed to mark delivery sent: update rejected'
    );
  });
});

describe('markDeliveryFailed', () => {
  it('records the retryable classification and truncated error', async () => {
    enqueue({ data: null, error: null });

    await expect(
      markDeliveryFailed('bid-1', 'failed_retryable', 'x'.repeat(800))
    ).resolves.toBeUndefined();

    const updateCall = mocks.state.calls.find((call) => call.method === 'update');
    const payload = updateCall?.args[0] as { status: string; last_error: string };
    expect(payload.status).toBe('failed_retryable');
    expect(payload.last_error).toHaveLength(500);
  });

  it.each(['failed_retryable', 'failed_permanent'] as const)(
    'persists %p classification',
    async (status) => {
      enqueue({ data: null, error: null });

      await markDeliveryFailed('bid-1', status, 'boom');

      const updateCall = mocks.state.calls.find((call) => call.method === 'update');
      expect((updateCall?.args[0] as { status: string }).status).toBe(status);
    }
  );

  it('throws descriptively on failure', async () => {
    enqueue({ data: null, error: { message: 'update rejected' } });

    await expect(markDeliveryFailed('bid-1', 'failed_permanent', 'e')).rejects.toThrow(
      'Failed to mark delivery failed: update rejected'
    );
  });
});
