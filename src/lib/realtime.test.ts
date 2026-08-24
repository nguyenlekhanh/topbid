import { beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeToBidChanges } from './realtime';

const supabaseMock = vi.hoisted(() => {
  type ChangeHandler = (payload: {
    eventType: string;
    new: Record<string, unknown>;
    old: Record<string, unknown>;
  }) => void;

  const state = {
    channels: [] as string[],
    changeFilters: [] as unknown[],
    changeHandlers: [] as ChangeHandler[],
    statusHandlers: [] as Array<(status: string) => void>,
    removedChannels: [] as string[],
  };

  function makeChannel(name: string) {
    const channel = {
      name,
      on(_type: string, filter: unknown, handler: ChangeHandler) {
        state.changeFilters.push(filter);
        state.changeHandlers.push(handler);
        return channel;
      },
      subscribe(statusHandler?: (status: string) => void) {
        if (statusHandler) {
          state.statusHandlers.push(statusHandler);
        }
        return channel;
      },
    };

    return channel;
  }

  function makeClient() {
    const client = {
      channel(name: string) {
        const channel = makeChannel(name);

        state.channels.push(channel.name);

        return channel;
      },
      removeChannel(channel: { name: string }) {
        state.removedChannels.push(channel.name);
        return Promise.resolve('ok' as const);
      },
    };

    return client;
  }

  return { state, makeClient };
});

vi.mock('@/lib/supabase', () => ({
  createClient: () => supabaseMock.makeClient(),
}));

const SAMPLE_ROW = {
  id: 'bid-1',
  category_id: 'cat-1',
  amount: 1500,
  bidder_email: 'a@b.com',
  bidder_name: null,
  stripe_session_id: 'cs_1',
  stripe_payment_intent_id: null,
  status: 'paid',
  is_highest: false,
  created_at: '2026-01-01T00:00:00Z',
  paid_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  supabaseMock.state.channels.length = 0;
  supabaseMock.state.changeHandlers.length = 0;
  supabaseMock.state.statusHandlers.length = 0;
  supabaseMock.state.removedChannels.length = 0;
});

describe('subscribeToBidChanges', () => {
  it('subscribes a postgres_changes listener on the public bids table', () => {
    subscribeToBidChanges(() => {});

    expect(supabaseMock.state.channels).toEqual(['bids-changes']);
    expect(supabaseMock.state.changeFilters).toEqual([
      { event: '*', schema: 'public', table: 'bids' },
    ]);
    expect(supabaseMock.state.changeHandlers).toHaveLength(1);
  });

  it('delivers mapped INSERT payloads to the callback', () => {
    const seen: unknown[] = [];
    subscribeToBidChanges((payload) => seen.push(payload));

    supabaseMock.state.changeHandlers[0]({
      eventType: 'INSERT',
      new: SAMPLE_ROW,
      old: {},
    });

    expect(seen).toEqual([
      {
        eventType: 'INSERT',
        new: SAMPLE_ROW,
        old: {},
      },
    ]);
  });

  it('delivers UPDATE and DELETE payloads through the same subscription', () => {
    const seen: unknown[] = [];
    subscribeToBidChanges((payload) => seen.push(payload));

    supabaseMock.state.changeHandlers[0]({
      eventType: 'UPDATE',
      new: { ...SAMPLE_ROW, status: 'paid', paid_at: '2026-02-01T00:00:00Z' },
      old: { ...SAMPLE_ROW },
    });

    supabaseMock.state.changeHandlers[0]({
      eventType: 'DELETE',
      new: {},
      old: SAMPLE_ROW,
    });

    expect(seen.map((payload) => (payload as { eventType: string }).eventType)).toEqual([
      'UPDATE',
      'DELETE',
    ]);
  });

  it('returns an unsubscribe closure that removes the channel', () => {
    const unsubscribe = subscribeToBidChanges(() => {});

    expect(supabaseMock.state.removedChannels).toHaveLength(0);

    unsubscribe();

    expect(supabaseMock.state.removedChannels).toHaveLength(1);
  });

  it('logs but does not throw on channel errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    subscribeToBidChanges(() => {});

    expect(() => {
      for (const handler of [...supabaseMock.state.statusHandlers]) {
        handler('CHANNEL_ERROR');
      }
    }).not.toThrow();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
