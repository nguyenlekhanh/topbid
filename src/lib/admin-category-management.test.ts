import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAdminCategory,
  listAllCategoriesForAdmin,
  parseDollarsToCents,
  setCategoryActive,
  updateAdminCategory,
} from './admin-category-management';
import type { Category } from './categories';

/**
 * Task 8.3 (+8.8 audit integration) - deterministic tests for server-side category
 * management. Authorization, audit, and service-role boundaries are mocked; the real
 * validation/normalization/persistence logic runs. No database or network.
 */

type FakeResult = { data: unknown; error: { message: string; code?: string } | null };

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
  const getAdminContext = vi.fn();
  const writeAuditLog = vi.fn();

  return { makeFakeClient, state, getAdminContext, writeAuditLog };
});

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => mocks.makeFakeClient(mocks.state),
}));

vi.mock('@/lib/admin-auth', () => ({
  getAdminContext: mocks.getAdminContext,
}));

vi.mock('@/lib/audit-log', () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

const ADMIN = { userId: '0b7f9c58-6f2e-4a55-9d0e-2f5f1a52f111', email: 'admin@topbid.lol' };

function enqueue(...results: FakeResult[]) {
  mocks.state.queue.push(...results);
}

beforeEach(() => {
  mocks.getAdminContext.mockReset();
  mocks.getAdminContext.mockResolvedValue({ authorized: true, ...ADMIN });
  mocks.writeAuditLog.mockReset();
  mocks.writeAuditLog.mockResolvedValue(true);
  mocks.state.queue.length = 0;
  mocks.state.calls.length = 0;
});

const validUuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const validCreate = {
  slug: 'art',
  name: 'Art & Collectibles',
  description: 'Rare artwork.',
  startingBid: '$500',
  increment: '$5',
};

describe('authorization gate', () => {
  it.each([
    ['create', () => createAdminCategory(validCreate)],
    ['update', () => updateAdminCategory({ id: validUuid, name: 'X' })],
    ['set-active', () => setCategoryActive({ id: validUuid, active: true })],
    ['list', () => listAllCategoriesForAdmin()],
  ])('%s fails closed for non-admins without touching the database', async (_label, call) => {
    mocks.getAdminContext.mockResolvedValue({ authorized: false });

    await expect(call()).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    expect(mocks.state.calls).toHaveLength(0);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe('parseDollarsToCents', () => {
  it.each([
    ['$500', 50000],
    ['12.5', 1250],
    ['12.55', 1255],
    ['0', 0],
    ['-5', null],
    ['1.234', null],
    ['abc', null],
    ['', null],
    [null as never, null],
    [42 as never, null],
  ])('parses %p -> %p', (value, expected) => {
    expect(parseDollarsToCents(value)).toBe(expected);
  });
});

describe('createAdminCategory', () => {
  it('inserts normalized values with is_active defaulting to true', async () => {
    enqueue({
      data: [{ id: validUuid }],
      error: null,
    });

    await expect(createAdminCategory(validCreate)).resolves.toEqual({ ok: true });

    const insertCall = mocks.state.calls.find((call) => call.method === 'insert');
    expect(insertCall?.args[0]).toEqual({
      slug: 'art',
      name: 'Art & Collectibles',
      description: 'Rare artwork.',
      starting_bid: 50000,
      increment: 500,
      image_url: null,
      is_active: true,
    });

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ADMIN.userId,
        actorEmail: ADMIN.email,
        action: 'category.create',
        targetType: 'category',
        targetId: validUuid,
        detail: { slug: 'art' },
      })
    );
  });

  it('normalizes uppercase/padded slugs before persisting', async () => {
    enqueue({ data: [{ id: validUuid }], error: null });

    await createAdminCategory({ ...validCreate, slug: '  Retro-Gaming  ' });

    const insertCall = mocks.state.calls.find((call) => call.method === 'insert');
    expect((insertCall?.args[0] as { slug: string }).slug).toBe('retro-gaming');
  });

  it('maps duplicate-slug violations to the stable slug_taken reason (coded)', async () => {
    enqueue({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint "categories_slug_key"',
        code: '23505',
      },
    });

    await expect(createAdminCategory(validCreate)).resolves.toEqual({
      ok: false,
      reason: 'slug_taken',
    });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it('maps duplicate-slug violations without a code field identically', async () => {
    enqueue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint' },
    });

    await expect(createAdminCategory(validCreate)).resolves.toEqual({
      ok: false,
      reason: 'slug_taken',
    });
  });

  it.each([
    ['invalid slug characters', { ...validCreate, slug: 'Not A Slug!' }],
    ['oversized slug', { ...validCreate, slug: 'x'.repeat(81) }],
    ['empty name', { ...validCreate, name: '   ' }],
    ['negative dollars', { ...validCreate, startingBid: '-1' }],
    ['malformed dollars', { ...validCreate, startingBid: '1.234' }],
    ['malformed increment', { ...validCreate, increment: 'abc' }],
    ['non-http image url', { ...validCreate, imageUrl: 'javascript:alert(1)' }],
  ])('rejects %s with invalid_input and no database write', async (_label, input) => {
    await expect(createAdminCategory(input)).resolves.toEqual({
      ok: false,
      reason: 'invalid_input',
    });
    expect(mocks.state.calls).toHaveLength(0);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it('maps unexpected database failures to db_error without leaking details', async () => {
    enqueue({ data: null, error: { message: 'connection reset by server' } });

    await expect(createAdminCategory(validCreate)).resolves.toEqual({
      ok: false,
      reason: 'db_error',
    });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe('updateAdminCategory', () => {
  it('updates provided fields, maintains updated_at, and audits the change', async () => {
    enqueue({ data: [{ id: validUuid }], error: null });

    await expect(
      updateAdminCategory({ id: validUuid, name: 'New Name', startingBid: '$600' })
    ).resolves.toEqual({ ok: true });

    const updateCall = mocks.state.calls.find((call) => call.method === 'update');
    const patch = updateCall?.args[0] as Record<string, unknown>;

    expect(patch.name).toBe('New Name');
    expect(patch.starting_bid).toBe(60000);
    expect(patch.slug).toBeUndefined();
    expect(typeof patch.updated_at).toBe('string');

    const eqCall = mocks.state.calls.filter((call) => call.method === 'eq').pop();
    expect(eqCall?.args).toEqual(['id', validUuid]);

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ADMIN.userId,
        actorEmail: ADMIN.email,
        action: 'category.update',
        targetType: 'category',
        targetId: validUuid,
      })
    );
  });

  it('clears the description when an empty string is submitted', async () => {
    enqueue({ data: [{ id: validUuid }], error: null });

    await updateAdminCategory({ id: validUuid, description: '   ' });

    const updateCall = mocks.state.calls.find((call) => call.method === 'update');
    expect((updateCall?.args[0] as { description: string | null }).description).toBeNull();
  });

  it('reports not_found when the update matches no rows', async () => {
    enqueue({ data: [], error: null });

    await expect(updateAdminCategory({ id: validUuid, name: 'Ghost' })).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed ids', { id: 'not-a-uuid', name: 'X' }],
    ['empty patches', { id: validUuid }],
    ['invalid field values', { id: validUuid, name: 'Valid', imageUrl: 'ftp://files' }],
  ])('rejects %s before querying', async (_label, input) => {
    await expect(updateAdminCategory(input as never)).resolves.toEqual({
      ok: false,
      reason: 'invalid_input',
    });
    expect(mocks.state.calls).toHaveLength(0);
  });
});

describe('setCategoryActive', () => {
  it.each([
    [true, true],
    ['false', false],
  ])('persists desired active state %p and audits the action', async (active, expected) => {
    enqueue({ data: [{ id: validUuid }], error: null });

    await expect(setCategoryActive({ id: validUuid, active })).resolves.toEqual({ ok: true });

    const updateCall = mocks.state.calls.find((call) => call.method === 'update');
    expect((updateCall?.args[0] as { is_active: boolean }).is_active).toBe(expected);

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ADMIN.userId,
        actorEmail: ADMIN.email,
        targetType: 'category',
        targetId: validUuid,
      })
    );

    const auditAction = mocks.writeAuditLog.mock.calls[0][0] as { action: string };
    const expectedAction =
      active === true || active === 'true' ? 'category.activate' : 'category.deactivate';
    expect(auditAction.action).toBe(expectedAction);
  });

  it.each([undefined, null, 'yes', 1])('rejects ambiguous active value %p', async (active) => {
    await expect(setCategoryActive({ id: validUuid, active: active as never })).resolves.toEqual({
      ok: false,
      reason: 'invalid_input',
    });
    expect(mocks.state.calls).toHaveLength(0);
  });

  it('reports not_found when the category row is missing', async () => {
    enqueue({ data: [], error: null });

    await expect(setCategoryActive({ id: validUuid, active: true })).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('listAllCategoriesForAdmin', () => {
  const ACTIVE_ROW: Category = {
    id: validUuid,
    slug: 'art',
    name: 'Art & Collectibles',
    description: null,
    starting_bid: 50000,
    increment: 5000,
    image_url: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const INACTIVE_ROW: Category = {
    ...ACTIVE_ROW,
    id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    slug: 'legacy',
    is_active: false,
  };

  it('returns the full category set including inactive rows', async () => {
    enqueue({ data: [ACTIVE_ROW, INACTIVE_ROW], error: null });

    const result = await listAllCategoriesForAdmin();

    expect(result.ok && result.categories.some((category) => !category.is_active)).toBe(true);
  });

  it('propagates failures as db_error without leaking internals', async () => {
    enqueue({ data: null, error: { message: 'permission denied for table categories' } });

    const result = await listAllCategoriesForAdmin();

    expect(result).toEqual({ ok: false, reason: 'db_error' });
  });
});
