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
    // When true, createClient() returns ONE singleton (mirrors the @supabase/ssr
    // browser-client behavior in production) so multiple subscribers share a socket.
    singletonMode: false,
    singleton: null as ReturnType<typeof makeClient> | null,
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

  function getClient() {
    if (!state.singletonMode) {
      return makeClient();
    }

    if (!state.singleton) {
      state.singleton = makeClient();
    }

    return state.singleton;
  }

  return { state, getClient };
});

vi.mock('@/lib/supabase', () => ({
  createClient: () => supabaseMock.getClient(),
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
  supabaseMock.state.singletonMode = false;
  supabaseMock.state.singleton = null;
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

describe('connection/reconnection handling (Task 5.7)', () => {
  it('does not treat the initial SUBSCRIBED as a recovery signal', () => {
    const onStatusChange = vi.fn();
    subscribeToBidChanges(() => {}, onStatusChange);

    supabaseMock.state.statusHandlers[0]('SUBSCRIBED');

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('maps CHANNEL_ERROR to disconnected and re-SUBSCRIBED to connected recovery', () => {
    const onStatusChange = vi.fn();
    subscribeToBidChanges(() => {}, onStatusChange);

    supabaseMock.state.statusHandlers[0]('CHANNEL_ERROR');
    supabaseMock.state.statusHandlers[0]('SUBSCRIBED');

    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      'disconnected',
      'connected',
    ]);
  });

  it('collapses repeated failures during a single outage into one disconnected signal', () => {
    const onStatusChange = vi.fn();
    subscribeToBidChanges(() => {}, onStatusChange);

    const rawHandler = supabaseMock.state.statusHandlers[0];
    rawHandler('CHANNEL_ERROR');
    rawHandler('TIMED_OUT');
    rawHandler('CLOSED');

    const disconnects = onStatusChange.mock.calls.filter(([status]) => status === 'disconnected');

    expect(disconnects).toHaveLength(1);
  });

  it('stays correct across repeated outage/recovery cycles', () => {
    const onStatusChange = vi.fn();
    subscribeToBidChanges(() => {}, onStatusChange);

    const rawHandler = supabaseMock.state.statusHandlers[0];

    rawHandler('CHANNEL_ERROR');
    rawHandler('SUBSCRIBED');
    rawHandler('TIMED_OUT');
    rawHandler('SUBSCRIBED');
    rawHandler('CLOSED');
    rawHandler('SUBSCRIBED');

    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      'disconnected',
      'connected',
      'disconnected',
      'connected',
      'disconnected',
      'connected',
    ]);
  });

  it('supports consumers that do not pass an onStatusChange callback', () => {
    expect(() => {
      subscribeToBidChanges(() => {});
      supabaseMock.state.statusHandlers[0]('SUBSCRIBED');
      supabaseMock.state.statusHandlers[0]('CHANNEL_ERROR');
    }).not.toThrow();
  });
});

describe('shared channel fan-out with multiple subscribers (runtime fix)', () => {
  beforeEach(() => {
    // Production reality: the @supabase/ssr browser client is a SINGLETON shared by
    // every component, and current supabase-js returns the SAME RealtimeChannel for a
    // repeated topic. Attaching postgres_changes callbacks after subscribe() throws:
    //   "cannot add `postgres_changes` callbacks ... after `subscribe()`"
    supabaseMock.state.singletonMode = true;
  });

  function broadcast(eventType: string, row: Record<string, unknown>): void {
    for (const handler of [...supabaseMock.state.changeHandlers]) {
      handler({ eventType, new: { ...SAMPLE_ROW, ...row }, old: {} });
    }
  }

  it('never attaches callbacks post-subscribe: N subscribers share exactly ONE channel', () => {
    const unsubscribers = [
      subscribeToBidChanges(() => {}),
      subscribeToBidChanges(() => {}),
      subscribeToBidChanges(() => {}),
      subscribeToBidChanges(() => {}),
    ];

    // The bug this pins: previously each subscriber called channel().on(...) again,
    // which throws on the already-subscribed shared channel instance.
    expect(supabaseMock.state.channels).toEqual(['bids-changes']);
    expect(supabaseMock.state.changeHandlers).toHaveLength(1);
    expect(supabaseMock.state.statusHandlers).toHaveLength(1);

    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  });

  it('fans every bid event out to all simultaneous subscribers', () => {
    const seenA: string[] = [];
    const seenB: string[] = [];

    subscribeToBidChanges((payload) => seenA.push(payload.eventType));
    subscribeToBidChanges((payload) => seenB.push(payload.eventType));

    broadcast('INSERT', {});

    expect(seenA).toEqual(['INSERT']);
    expect(seenB).toEqual(['INSERT']);
  });

  it('a throwing consumer cannot block delivery to other subscribers', () => {
    const seen: string[] = [];

    subscribeToBidChanges(() => {
      throw new Error('consumer exploded');
    });
    subscribeToBidChanges((payload) => seen.push(payload.eventType));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    broadcast('UPDATE', {});

    expect(seen).toEqual(['UPDATE']);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('unsubscribing one subscriber keeps the shared channel alive for the rest', () => {
    const seen: string[] = [];
    const unsubscribeFirst = subscribeToBidChanges(() => {});
    subscribeToBidChanges((payload) => seen.push(payload.eventType));

    unsubscribeFirst();

    broadcast('INSERT', {});

    expect(seen).toEqual(['INSERT']);
    expect(supabaseMock.state.removedChannels).toHaveLength(0);
  });

  it('removes the channel only when the LAST subscriber leaves', () => {
    const unsubscribeA = subscribeToBidChanges(() => {});
    const unsubscribeB = subscribeToBidChanges(() => {});

    unsubscribeA();
    expect(supabaseMock.state.removedChannels).toHaveLength(0);

    unsubscribeB();
    expect(supabaseMock.state.removedChannels).toEqual(['bids-changes']);
  });

  it('re-subscribing after full teardown starts from a FRESH channel (Strict Mode safe)', () => {
    // Mount -> unmount -> remount cycle: teardown removes the subscribed instance so
    // the next mount never attaches callbacks to a stale, already-subscribed channel.
    const first = subscribeToBidChanges(() => {});
    first();

    const seen: string[] = [];
    subscribeToBidChanges((payload) => seen.push(payload.eventType));

    // Two PHYSICAL channels existed over time, each carrying exactly ONE internal
    // postgres_changes handler - the invariant the post-subscribe guard requires.
    expect(supabaseMock.state.channels).toEqual(['bids-changes', 'bids-changes']);
    expect(supabaseMock.state.changeHandlers).toHaveLength(2);
    expect(supabaseMock.state.removedChannels).toEqual(['bids-changes']);

    // The fresh channel delivers to the new subscriber.
    const latestHandler = supabaseMock.state.changeHandlers.at(-1)!;

    latestHandler({ eventType: 'INSERT', new: { ...SAMPLE_ROW }, old: {} });

    expect(seen).toEqual(['INSERT']);
  });

  it('fan-outs status changes to every subscriber with once-per-outage dedup intact', () => {
    const statusesA: string[] = [];
    const statusesB: string[] = [];

    subscribeToBidChanges(
      () => {},
      (status) => statusesA.push(status)
    );
    subscribeToBidChanges(
      () => {},
      (status) => statusesB.push(status)
    );

    for (const handler of [...supabaseMock.state.statusHandlers]) {
      handler('CHANNEL_ERROR');
      handler('TIMED_OUT');
      handler('SUBSCRIBED');
    }

    expect(statusesA).toEqual(['disconnected', 'connected']);
    expect(statusesB).toEqual(['disconnected', 'connected']);
  });

  describe('CLOSED lifecycle semantics (intentional teardown vs outage)', () => {
    it('self-teardown fires CLOSED but logs nothing and emits no disconnected signal', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onStatusChange = vi.fn();

      const unsubscribe = subscribeToBidChanges(() => {}, onStatusChange);

      // Last subscriber out -> intentional removeChannel -> phoenix leave lifecycle
      // surfaces CLOSED afterwards.
      unsubscribe();

      for (const handler of [...supabaseMock.state.statusHandlers]) {
        handler('CLOSED');
      }

      expect(errorSpy).not.toHaveBeenCalled();
      expect(onStatusChange).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('an externally generated CLOSED is still treated as an outage', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onStatusChange = vi.fn();

      subscribeToBidChanges(() => {}, onStatusChange);

      // No self-teardown happened: the server/provider closed the topic.
      supabaseMock.state.statusHandlers[0]('CLOSED');

      expect(errorSpy).toHaveBeenCalledWith('[realtime] bids channel problem: CLOSED');
      expect(onStatusChange).toHaveBeenCalledWith('disconnected');
      errorSpy.mockRestore();
    });

    it('CHANNEL_ERROR/TIMED_OUT handling is unchanged when other subscribers remain', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onStatusChange = vi.fn();

      const leaving = subscribeToBidChanges(() => {});
      const stayingUnsub = subscribeToBidChanges(() => {}, onStatusChange);

      // Partial unsubscribe: NOT last out -> intentional-teardown flag stays false.
      leaving();

      for (const handler of [...supabaseMock.state.statusHandlers]) {
        handler('CHANNEL_ERROR');
        handler('TIMED_OUT');
      }

      expect(errorSpy).toHaveBeenCalledTimes(1); // once-per-outage dedup preserved
      expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual(['disconnected']);
      expect(stayingUnsub).toBeTypeOf('function');
      errorSpy.mockRestore();
    });

    it('a fully-torn-down subscription notifies no subscribers on later statuses', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onStatusChange = vi.fn();

      const unsubscribe = subscribeToBidChanges(() => {}, onStatusChange);
      unsubscribe();

      for (const handler of [...supabaseMock.state.statusHandlers]) {
        handler('CHANNEL_ERROR');
        handler('TIMED_OUT');
      }

      // No subscriber remains, so no disconnected/connected signal can be emitted.
      expect(onStatusChange).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
