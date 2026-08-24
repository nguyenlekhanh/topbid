import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUDIT_ACTIONS, readAuditLogs, writeAuditLog } from './audit-log';

/**
 * Task 8.8 - deterministic tests for the immutable admin audit trail.
 * Service-role boundary mocked with the queue-based fake; no database or network.
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

const ENTRY = {
  actorUserId: '0b7f9c58-6f2e-4a55-9d0e-2f5f1a52f111',
  actorEmail: 'admin@topbid.lol',
  action: 'category.create' as const,
  targetType: 'category',
  targetId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  detail: { slug: 'art', starting_bid_cents: 50000 },
};

beforeEach(() => {
  mocks.getAdminAuthorization.mockReset();
  mocks.getAdminAuthorization.mockResolvedValue({ authorized: true, userId: 'admin-1' });
  mocks.state.queue.length = 0;
  mocks.state.calls.length = 0;
});

describe('AUDIT_ACTIONS allow-list', () => {
  it('covers exactly the seven auditable Phase 8 mutations', () => {
    expect([...AUDIT_ACTIONS]).toEqual([
      'category.create',
      'category.update',
      'category.activate',
      'category.deactivate',
      'payment.refund',
      'banned_email.ban',
      'banned_email.unban',
    ]);
  });
});

describe('writeAuditLog', () => {
  it('inserts an immutable record with actor/action/target/detail', async () => {
    enqueue({ data: null, error: null });

    await expect(writeAuditLog(ENTRY)).resolves.toBe(true);

    const insertCall = mocks.state.calls.find((call) => call.method === 'insert');
    expect(insertCall?.args[0]).toEqual({
      actor_user_id: ENTRY.actorUserId,
      actor_email: ENTRY.actorEmail,
      action: ENTRY.action,
      target_type: 'category',
      target_id: ENTRY.targetId,
      detail: ENTRY.detail,
    });
  });

  it('never invokes mutating methods other than insert', async () => {
    enqueue({ data: null, error: null });

    await writeAuditLog(ENTRY);

    const methods = mocks.state.calls.map((call) => call.method);
    expect(methods).toEqual(['from', 'insert']);
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('delete');
    expect(methods).not.toContain('upsert');
  });

  it('rejects action names outside the allow-list without querying', async () => {
    const result = await writeAuditLog({
      ...ENTRY,
      action: 'page_view' as never,
    });

    expect(result).toBe(false);
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('reports failure when persistence fails and never throws', async () => {
    enqueue({ data: null, error: { message: 'database unavailable' } });

    await expect(writeAuditLog(ENTRY)).resolves.toBe(false);
  });

  it('does not leak raw database errors through thrown exceptions', async () => {
    enqueue({ data: null, error: { message: 'permission denied for table audit_logs' } });

    await expect(writeAuditLog(ENTRY)).resolves.toBe(false);
  });
});

describe('readAuditLogs', () => {
  it('fails closed for non-admins without querying', async () => {
    mocks.getAdminAuthorization.mockResolvedValue({ authorized: false });

    const result = await readAuditLogs();

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('returns newest-first entries for authorized admins', async () => {
    enqueue({
      data: [
        {
          id: 2,
          actor_user_id: 'admin-1',
          actor_email: 'admin@topbid.lol',
          action: 'payment.refund',
          target_type: 'bid',
          target_id: 'bid-1',
          created_at: '2026-03-01T00:00:00Z',
        },
      ],
      error: null,
    });

    const result = await readAuditLogs();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        actorEmail: 'admin@topbid.lol',
        action: 'payment.refund',
        targetType: 'bid',
        targetId: 'bid-1',
      });
    }

    // Bounded read window:
    expect(mocks.state.calls.find((call) => call.method === 'limit')?.args).toEqual([100]);
    expect(mocks.state.calls.find((call) => call.method === 'order')?.args).toEqual([
      'created_at',
      { ascending: false },
    ]);
  });

  it('propagates read failures as db_error', async () => {
    enqueue({ data: null, error: { message: 'database unavailable' } });

    const result = await readAuditLogs();

    expect(result.ok === false && result.reason).toBe('db_error');
  });
});
