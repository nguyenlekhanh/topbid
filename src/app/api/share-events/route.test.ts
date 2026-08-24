import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/share-events/route';

/**
 * Task 7.7 — deterministic tests for the share-event ingestion endpoint.
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

  const state = { queue: [] as FakeResult[], calls: [] as CallLog };

  return { makeFakeClient, state };
});

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => mocks.makeFakeClient(mocks.state),
}));

function postRequest(body: string): Request {
  return new Request('http://localhost/api/share-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  mocks.state.queue.length = 0;
  mocks.state.calls.length = 0;
});

describe('POST /api/share-events (Task 7.7)', () => {
  it('persists an x_share event with the service-role client', async () => {
    mocks.state.queue.push({ data: null, error: null });

    const response = await POST(postRequest(JSON.stringify({ event: 'x_share' })));

    expect(response.status).toBe(200);
    const insertCall = mocks.state.calls.find((call) => call.method === 'insert');
    expect(insertCall?.args[0]).toEqual({ event: 'x_share' });
  });

  it('persists a copy_link event identically', async () => {
    mocks.state.queue.push({ data: null, error: null });

    const response = await POST(postRequest(JSON.stringify({ event: 'copy_link' })));

    expect(response.status).toBe(200);
    expect(mocks.state.calls.find((call) => call.method === 'insert')?.args[0]).toEqual({
      event: 'copy_link',
    });
  });

  it.each(['page_view', 'share_x', '', 42, null])(
    'rejects unknown event %p with 400 and no write',
    async (event) => {
      const response = await POST(postRequest(JSON.stringify({ event })));

      expect(response.status).toBe(400);
      expect(mocks.state.calls).toHaveLength(0);
    }
  );

  it('rejects malformed JSON bodies with 400', async () => {
    const response = await POST(postRequest('not-json'));

    expect(response.status).toBe(400);
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('rejects non-object payloads with 400', async () => {
    const response = await POST(postRequest('"just a string"'));

    expect(response.status).toBe(400);
  });

  it('answers 500 on database failures without leaking internals', async () => {
    mocks.state.queue.push({ data: null, error: { message: 'database unavailable' } });

    const response = await POST(postRequest(JSON.stringify({ event: 'x_share' })));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe('Failed to record share event');
    expect(body.error).not.toContain('database unavailable');
  });

  it('counts repeated share actions as separate events (no dedup invented)', async () => {
    mocks.state.queue.push({ data: null, error: null });
    mocks.state.queue.push({ data: null, error: null });

    await POST(postRequest(JSON.stringify({ event: 'x_share' })));
    await POST(postRequest(JSON.stringify({ event: 'x_share' })));

    expect(mocks.state.calls.filter((call) => call.method === 'insert')).toHaveLength(2);
  });

  it('never persists anything beyond the allow-listed event name', async () => {
    mocks.state.queue.push({ data: null, error: null });

    await POST(
      postRequest(
        JSON.stringify({
          event: 'x_share',
          url: '/success?session_id=cs_secret',
          bid_id: 'bid-1',
          email: 'x@y.com',
        })
      )
    );

    const insertCall = mocks.state.calls.find((call) => call.method === 'insert');
    expect(insertCall?.args[0]).toEqual({ event: 'x_share' });
  });
});
