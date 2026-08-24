import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHmac } from 'node:crypto';

import {
  buildUnsubscribeUrl,
  getUnsubscribeToken,
  hasUnsubscribeRecord,
  isUnsubscribed,
  isValidUnsubscribeTokenShape,
  listUnsubscribeHeaders,
  unsubscribeByToken,
} from './unsubscribe';

/**
 * Task 6.6 — deterministic tests for application-managed unsubscribe handling.
 *
 * The database boundary (service-role client) is faked with the established
 * queue-based proxy; tokens are computed genuinely with node:crypto HMAC so the
 * security properties (determinism, normalization, shape) are exercised for real.
 * No network and no real email delivery occur.
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

  const serviceState: FakeState = { queue: [], calls: [] };

  return { makeFakeClient, serviceState };
});

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => mocks.makeFakeClient(mocks.serviceState),
}));

const SECRET = 'unit-test-secret-0123456789abcdef0123456789abcdef';

function expectedToken(email: string): string {
  return createHmac('sha256', SECRET).update(email.trim().toLowerCase()).digest('hex');
}

beforeEach(() => {
  vi.stubEnv('UNSUBSCRIBE_SECRET', SECRET);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://topbid.lol');
  mocks.serviceState.queue.length = 0;
  mocks.serviceState.calls.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getUnsubscribeToken', () => {
  it('derives the deterministic keyed hash for a recipient', () => {
    expect(getUnsubscribeToken('champ@example.com')).toBe(expectedToken('champ@example.com'));
  });

  it('normalizes case and surrounding whitespace before hashing', () => {
    expect(getUnsubscribeToken('  CHAMP@Example.COM ')).toBe(expectedToken('champ@example.com'));
  });

  it('produces distinct tokens for distinct recipients (no cross-recipient reuse)', () => {
    expect(getUnsubscribeToken('a@example.com')).not.toBe(getUnsubscribeToken('b@example.com'));
  });

  it.each([null as unknown as string, undefined as unknown as string, '', '   ', 'x'.repeat(255)])(
    'returns null for malformed recipient %p without touching the database',
    (email) => {
      expect(getUnsubscribeToken(email)).toBeNull();
      expect(mocks.serviceState.calls).toHaveLength(0);
    }
  );

  it.each(['', '   '])('rejects a %p secret descriptively', (secret) => {
    vi.stubEnv('UNSUBSCRIBE_SECRET', secret);

    expect(() => getUnsubscribeToken('champ@example.com')).toThrow(
      'Missing UNSUBSCRIBE_SECRET environment variable'
    );
  });

  it('rejects a too-short secret descriptively', () => {
    vi.stubEnv('UNSUBSCRIBE_SECRET', 'short');

    expect(() => getUnsubscribeToken('champ@example.com')).toThrow(
      'UNSUBSCRIBE_SECRET must be at least 32 characters'
    );
  });
});

describe('buildUnsubscribeUrl', () => {
  it('builds the absolute tokenized URL on the configured base', () => {
    expect(buildUnsubscribeUrl('champ@example.com')).toBe(
      `https://topbid.lol/unsubscribe?token=${expectedToken('champ@example.com')}`
    );
  });

  it('normalizes a trailing slash on the base URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://topbid.lol/');

    expect(buildUnsubscribeUrl('champ@example.com')).toBe(
      `https://topbid.lol/unsubscribe?token=${expectedToken('champ@example.com')}`
    );
  });

  it('never embeds the raw email address in the URL', () => {
    const url = buildUnsubscribeUrl('champ@example.com');

    expect(url).not.toContain('@');
    expect(url).toContain(expectedToken('champ@example.com'));
  });

  it('throws descriptively when the base URL is not configured', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    expect(() => buildUnsubscribeUrl('champ@example.com')).toThrow(
      'Missing NEXT_PUBLIC_APP_URL: required to build the unsubscribe link'
    );
  });

  it('returns null for malformed recipients instead of building a link', () => {
    expect(buildUnsubscribeUrl('   ')).toBeNull();
  });
});

describe('listUnsubscribeHeaders', () => {
  it('advertises one-click unsubscription for the exact URL', () => {
    expect(listUnsubscribeHeaders('https://topbid.lol/unsubscribe?token=abc')).toEqual({
      'List-Unsubscribe': '<https://topbid.lol/unsubscribe?token=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});

describe('isValidUnsubscribeTokenShape', () => {
  it('accepts a 64-character lowercase hex digest', () => {
    expect(isValidUnsubscribeTokenShape(expectedToken('a@b.com'))).toBe(true);
  });

  it.each([
    null,
    undefined,
    123,
    '',
    'zz'.repeat(32),
    `${'a'.repeat(63)}g`,
    'a'.repeat(65),
    `${expectedToken('a@b.com')}extra`,
  ])('rejects malformed token %p', (token) => {
    expect(isValidUnsubscribeTokenShape(token)).toBe(false);
  });
});

describe('unsubscribeByToken', () => {
  it('records the suppression through an idempotent service-role upsert', async () => {
    mocks.serviceState.queue.push({ data: null, error: null, count: 1 });

    await expect(unsubscribeByToken(expectedToken('champ@example.com'))).resolves.toBe(
      'unsubscribed'
    );

    const upsertCall = mocks.serviceState.calls.find((call) => call.method === 'upsert');
    expect(upsertCall?.args[0]).toEqual({
      recipient_hash: expectedToken('champ@example.com'),
    });
    expect(upsertCall?.args[1]).toMatchObject({
      onConflict: 'recipient_hash',
      ignoreDuplicates: true,
    });
  });

  it('reports already-unsubscribed when the insert was ignored as a duplicate', async () => {
    mocks.serviceState.queue.push({ data: null, error: null, count: 0 });

    await expect(unsubscribeByToken(expectedToken('champ@example.com'))).resolves.toBe(
      'already_unsubscribed'
    );
  });

  it('treats a repeated unsubscribe safely (same outcome path, no error)', async () => {
    mocks.serviceState.queue.push({ data: null, error: null, count: 1 });
    mocks.serviceState.queue.push({ data: null, error: null, count: 0 });

    await expect(unsubscribeByToken(expectedToken('a@b.com'))).resolves.toBe('unsubscribed');
    await expect(unsubscribeByToken(expectedToken('a@b.com'))).resolves.toBe(
      'already_unsubscribed'
    );
  });

  it('throws before any database access for malformed tokens', async () => {
    await expect(unsubscribeByToken('not-a-token')).rejects.toThrow('Invalid unsubscribe token');
    expect(mocks.serviceState.calls).toHaveLength(0);
  });

  it('propagates database failures descriptively', async () => {
    mocks.serviceState.queue.push({
      data: null,
      error: { message: 'database unavailable' },
    });

    await expect(unsubscribeByToken(expectedToken('a@b.com'))).rejects.toThrow(
      'Failed to record unsubscribe: database unavailable'
    );
  });
});

describe('isUnsubscribed', () => {
  it('reports suppressed recipients by exact token match', async () => {
    mocks.serviceState.queue.push({
      data: { recipient_hash: expectedToken('champ@example.com') },
      error: null,
    });

    await expect(isUnsubscribed('CHAMP@example.com ')).resolves.toBe(true);

    const selectCall = mocks.serviceState.calls.find((call) => call.method === 'eq');
    expect(selectCall?.args).toEqual(['recipient_hash', expectedToken('champ@example.com')]);
  });

  it('reports subscribed (default) recipients when no row exists', async () => {
    mocks.serviceState.queue.push({ data: null, error: null });

    await expect(isUnsubscribed('fresh@example.com')).resolves.toBe(false);
  });

  it('treats malformed emails as not unsubscribed without querying', async () => {
    await expect(isUnsubscribed('   ')).resolves.toBe(false);
    expect(mocks.serviceState.calls).toHaveLength(0);
  });

  it('propagates lookup failures descriptively', async () => {
    mocks.serviceState.queue.push({ data: null, error: { message: 'database unavailable' } });

    await expect(isUnsubscribed('a@b.com')).rejects.toThrow(
      'Failed to check unsubscribe state: database unavailable'
    );
  });
});

describe('hasUnsubscribeRecord (token-direct lookup for the unsubscribe page)', () => {
  it('queries by the exact token and reports existing records', async () => {
    const token = expectedToken('champ@example.com');
    mocks.serviceState.queue.push({ data: { recipient_hash: token }, error: null });

    await expect(hasUnsubscribeRecord(token)).resolves.toBe(true);

    const selectCall = mocks.serviceState.calls.find((call) => call.method === 'eq');
    expect(selectCall?.args).toEqual(['recipient_hash', token]);
  });

  it('reports false for well-shaped tokens with no record', async () => {
    mocks.serviceState.queue.push({ data: null, error: null });

    await expect(hasUnsubscribeRecord(expectedToken('nobody@example.com'))).resolves.toBe(false);
  });

  it.each([null as unknown as string, undefined as unknown as string, '', 'forged-token'])(
    'returns false for malformed token %p without querying',
    async (token) => {
      await expect(hasUnsubscribeRecord(token)).resolves.toBe(false);
      expect(mocks.serviceState.calls).toHaveLength(0);
    }
  );
});
