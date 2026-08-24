import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  banEmail,
  canonicalizeEmail,
  isEmailBanned,
  listBannedEmails,
  unbanEmail,
} from './email-bans';

/**
 * Task 8.7 — deterministic tests for the banned-email blocklist.
 * Service-role boundary mocked with the queue-based fake; no real database.
 */

type FakeResult = { data: unknown; error: { message: string } | null; count?: number | null };

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
  const getAdminAuthorization = vi.fn();
  const getAdminContext = vi.fn();

  return { makeFakeClient, state, getAdminAuthorization, getAdminContext };
});

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => mocks.makeFakeClient(mocks.state),
}));

vi.mock('@/lib/admin-auth', () => ({
  getAdminAuthorization: mocks.getAdminAuthorization,
  getAdminContext: mocks.getAdminContext,
}));
vi.mock('@/lib/audit-log', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(true),
}));

function enqueue(...results: FakeResult[]) {
  mocks.state.queue.push(...results);
}

beforeEach(() => {
  mocks.getAdminAuthorization.mockReset();
  mocks.getAdminAuthorization.mockResolvedValue({ authorized: true, userId: 'admin-1' });
  mocks.getAdminContext.mockReset();
  mocks.getAdminContext.mockResolvedValue({ authorized: true, userId: 'admin-1' });
  mocks.state.queue.length = 0;
  mocks.state.calls.length = 0;
});

describe('canonicalizeEmail', () => {
  it('lowercases and trims to the canonical identity', () => {
    expect(canonicalizeEmail('  Fraud@Example.COM ')).toBe('fraud@example.com');
  });

  it.each([null, undefined, '', '   ', 'no-at-sign', 'a b@c.com', 'x'.repeat(255)])(
    'rejects invalid email %p',
    (value) => {
      expect(canonicalizeEmail(value as never)).toBeNull();
    }
  );
});

describe('isEmailBanned', () => {
  it('matches case-insensitively against the canonical column', async () => {
    enqueue({ data: { email_canonical: 'fraud@example.com' }, error: null });

    await expect(isEmailBanned('FRAUD@Example.com')).resolves.toBe(true);

    const eqCall = mocks.state.calls.find((call) => call.method === 'eq');
    expect(eqCall?.args).toEqual(['email_canonical', 'fraud@example.com']);
  });

  it('returns false when no ban exists', async () => {
    enqueue({ data: null, error: null });

    await expect(isEmailBanned('clean@example.com')).resolves.toBe(false);
  });

  it('treats invalid emails as not banned without querying', async () => {
    await expect(isEmailBanned('   ')).resolves.toBe(false);
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('propagates lookup failures descriptively', async () => {
    enqueue({ data: null, error: { message: 'database unavailable' } });

    await expect(isEmailBanned('a@b.com')).rejects.toThrow(
      'Failed to check ban state: database unavailable'
    );
  });
});

describe('banEmail / unbanEmail (admin operations)', () => {
  it('inserts a ban idempotently and reports first-time vs repeat outcomes', async () => {
    mocks.state.queue.push({ data: null, error: null, count: 1 });

    await expect(banEmail('Fraud@Example.com')).resolves.toEqual({ ok: true, outcome: 'banned' });

    const upsertCall = mocks.state.calls.find((call) => call.method === 'upsert');
    expect(upsertCall?.args[0]).toEqual({ email_canonical: 'fraud@example.com' });
    expect(upsertCall?.args[1]).toMatchObject({
      onConflict: 'email_canonical',
      ignoreDuplicates: true,
    });

    mocks.state.queue.push({ data: null, error: null, count: 0 });

    await expect(banEmail('fraud@example.com')).resolves.toEqual({
      ok: true,
      outcome: 'already_banned',
    });
  });

  it('deletes a ban and reports the outcome by affected rows', async () => {
    mocks.state.queue.push({ data: [], error: null, count: 1 });

    await expect(unbanEmail('Fraud@Example.com')).resolves.toEqual({
      ok: true,
      outcome: 'unbanned',
    });

    const deleteCall = mocks.state.calls.find((call) => call.method === 'delete');
    expect(deleteCall).toBeDefined();
  });

  it('reports not_banned when unbanning an address that was never banned', async () => {
    mocks.state.queue.push({ data: [], error: null, count: 0 });

    await expect(unbanEmail('ghost@example.com')).resolves.toEqual({
      ok: true,
      outcome: 'not_banned',
    });
  });

  it('fails closed on unauthorized admin operations before any query', async () => {
    mocks.getAdminContext.mockResolvedValue({ authorized: false });

    await expect(banEmail('a@b.com')).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    await expect(unbanEmail('a@b.com')).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    await expect(listBannedEmails()).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('rejects invalid emails without querying', async () => {
    await expect(banEmail('bad')).resolves.toEqual({ ok: false, reason: 'invalid_email' });
    await expect(unbanEmail('bad')).resolves.toEqual({ ok: false, reason: 'invalid_email' });
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('maps database failures to db_error without leaking details', async () => {
    mocks.state.queue.push({ data: null, error: { message: 'permission denied' } });

    await expect(banEmail('a@b.com')).resolves.toEqual({ ok: false, reason: 'db_error' });
  });
});

describe('listBannedEmails', () => {
  it('returns the blocklist newest-first with canonical emails only', async () => {
    enqueue({
      data: [
        { email_canonical: 'newest@example.com', created_at: '2026-03-01T00:00:00Z' },
        { email_canonical: 'oldest@example.com', created_at: '2026-01-01T00:00:00Z' },
      ],
      error: null,
    });

    const result = await listBannedEmails();

    expect(result.ok && result.bans[0].emailCanonical).toBe('newest@example.com');
    expect(result.ok && result.bans).toHaveLength(2);
  });

  it('propagates failures as db_error', async () => {
    mocks.state.queue.push({ data: null, error: { message: 'down' } });

    const result = await listBannedEmails();

    expect(result.ok === false && result.reason).toBe('db_error');
  });
});
