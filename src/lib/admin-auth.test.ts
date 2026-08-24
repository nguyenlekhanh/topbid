import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAdminAuthorization, sanitizeNextPath } from './admin-auth';

/**
 * Task 8.1 — deterministic tests for the admin authentication boundary.
 * Queue-based fake Supabase client keeps the real guard logic in play; no real
 * Supabase Auth or network calls occur.
 */

type FakeResult = { data: unknown; error: { message: string } | null };

const mocks = vi.hoisted(() => {
  type CallLog = Array<{ method: string; args: unknown[] }>;
  type FakeState = {
    queue: FakeResult[];
    calls: CallLog;
    authResponse: { data: { user: { id: string } | null }; error: { message: string } | null };
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

  const state: FakeState = {
    queue: [],
    calls: [],
    authResponse: { data: { user: null }, error: null },
  };

  return { state, makeFakeBuilder };
});

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: {
      // The guard awaits this directly; it is not part of the chain-builder queue.
      getUser: async () => mocks.state.authResponse,
    },
    from: () => mocks.makeFakeBuilder(mocks.state),
  }),
}));

function setAuthUser(user: { id: string } | null, error: { message: string } | null = null) {
  mocks.state.authResponse = { data: { user }, error };
}

beforeEach(() => {
  mocks.state.queue.length = 0;
  mocks.state.calls.length = 0;
  setAuthUser(null);
});

describe('getAdminAuthorization', () => {
  it('authorizes an authenticated user with an admin_users membership row', async () => {
    setAuthUser({ id: 'user-1' });
    mocks.state.queue.push({ data: { id: 'user-1' }, error: null });

    await expect(getAdminAuthorization()).resolves.toEqual({
      authorized: true,
      userId: 'user-1',
    });

    const eqCall = mocks.state.calls.find((call) => call.method === 'eq');
    expect(eqCall?.args).toEqual(['id', 'user-1']);
  });

  it('rejects unauthenticated visitors before any membership query', async () => {
    await expect(getAdminAuthorization()).resolves.toEqual({ authorized: false });
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('rejects authenticated non-admin users (no membership row)', async () => {
    setAuthUser({ id: 'user-2' });
    mocks.state.queue.push({ data: null, error: null });

    await expect(getAdminAuthorization()).resolves.toEqual({ authorized: false });
  });

  it('fails closed when the membership lookup errors', async () => {
    setAuthUser({ id: 'user-1' });
    mocks.state.queue.push({ data: null, error: { message: 'database unavailable' } });

    await expect(getAdminAuthorization()).resolves.toEqual({ authorized: false });
  });

  it('fails closed when the session lookup errors', async () => {
    setAuthUser(null, { message: 'session expired' });

    await expect(getAdminAuthorization()).resolves.toEqual({ authorized: false });
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('rejects a malformed session payload without querying', async () => {
    setAuthUser({} as never);

    await expect(getAdminAuthorization()).resolves.toEqual({ authorized: false });
    expect(mocks.state.calls).toHaveLength(0);
  });
});

describe('sanitizeNextPath (open-redirect protection)', () => {
  it.each(['/admin', '/admin/settings', '/?returned=1', '   /admin   '])(
    'accepts same-origin relative path %p',
    (value) => {
      expect(sanitizeNextPath(value)).toBe((value as string).trim());
    }
  );

  it.each([
    null,
    undefined,
    '',
    'https://evil.example.com/admin',
    '//evil.example.com',
    '/\\evil.example.com',
    'admin/login',
    'javascript:alert(1)',
  ])('rejects unsafe value %p', (value) => {
    expect(sanitizeNextPath(value)).toBeNull();
  });
});
