import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task 9.10 — Fraud scenarios.
 *
 * Cross-module fraud guarantees proven with deterministic tests over the REAL
 * enforcement modules (email-bans, unsubscribe, outbid-notification) backed by an
 * in-memory database that mirrors the production access patterns:
 *
 * - banned_emails / notification_unsubscribes are keyed stores; the fake implements
 *   exactly the query chains production code uses (.select().eq().maybeSingle(),
 *   ignoreDuplicates upserts with row counts, counted deletes, ordered select-all)
 * - canonical identity (lower(trim(email))) is exercised end-to-end so casing and
 *   whitespace variants of a banned address can never slip through
 * - admin authorization is mocked at the Task 8.1 boundary to prove fail-closed abuse
 *   handling without cookie infrastructure
 *
 * NO new production behavior, NO fraud scoring/providers/queues/CAPTCHA - this suite
 * pins the existing boundaries against the fraud scenarios they were built for.
 */

type Row = Record<string, unknown>;
type TableMap = Map<string, Row>;

const harness = vi.hoisted(() => {
  const state = {
    tables: {
      banned_emails: null as TableMap | null,
      notification_unsubscribes: null as TableMap | null,
    },
    writes: [] as string[],
    reads: 0,
    lookupError: null as string | null,
    admin: { authorized: true, userId: 'admin-1', email: 'admin@topbid.lol' },
    auditEntries: [] as Array<Record<string, unknown>>,
    deliveries: new Map<string, { status: string; attempts: number }>(),
    emailsSent: [] as Array<{ to: string; subject: string }>,
    resolvedPaidBid: null as {
      bid: {
        id: string;
        category_id: string;
        amount: number;
        bidder_email: string;
        bidder_name: string;
      };
      category: { id: string; slug: string; name: string };
    } | null,
    previousBidder: null as {
      bidId: string;
      bidderEmail: string;
      bidderName: string;
      amount: number;
    } | null,
  };
  return state;
});

class FakeQuery {
  private filters: Array<[string, string]> = [];
  private mode: 'select' | 'delete' = 'select';

  constructor(private readonly table: keyof typeof harness.tables) {}

  select(): FakeQuery {
    return this;
  }

  eq(column: string, value: unknown): FakeQuery {
    this.filters.push([column, String(value)]);
    return this;
  }

  order(): FakeQuery {
    // Production callers only list newest-first; ordering is irrelevant here.
    return this;
  }

  upsert(
    row: Row,
    options?: { onConflict?: string; ignoreDuplicates?: boolean }
  ): { count: number | null; error: null } {
    const map = harness.tables[this.table]!;
    const keyColumn = options?.onConflict ?? 'id';
    const key = String(row[keyColumn]);
    const existed = map.has(key);

    if (!existed) {
      map.set(key, { ...row });
      harness.writes.push(`upsert:${this.table}`);
    }

    return { count: existed ? 0 : 1, error: null };
  }

  /** Production chain: .delete({count}).eq(key, value) - executed on await. */
  delete(): FakeQuery {
    this.mode = 'delete';
    return this;
  }

  maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
    harness.reads += 1;

    if (harness.lookupError) {
      return Promise.resolve({ data: null, error: { message: harness.lookupError } });
    }

    const [, value] = this.filters[0] ?? [];
    const map = harness.tables[this.table]!;
    const row = value !== undefined ? map.get(value) : undefined;

    return Promise.resolve({ data: row ? { ...row } : null, error: null });
  }

  then<T>(resolve: (value: { data?: Row[]; count?: number | null; error: null }) => T): Promise<T> {
    harness.reads += 1;

    if (this.mode === 'delete') {
      const map = harness.tables[this.table]!;
      let count = 0;

      for (const [, value] of this.filters) {
        if (map.delete(value)) {
          count += 1;
          harness.writes.push(`delete:${this.table}`);
        }
      }

      return Promise.resolve(resolve({ count, error: null }));
    }

    const rows = [...harness.tables[this.table]!.values()].sort((a, b) =>
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
    );

    return Promise.resolve(resolve({ data: rows.map((row) => ({ ...row })), error: null }));
  }
}

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: keyof typeof harness.tables) => new FakeQuery(table),
  }),
}));

vi.mock('@/lib/admin-auth', () => ({
  getAdminContext: async () =>
    harness.admin.authorized
      ? { authorized: true, userId: harness.admin.userId, email: harness.admin.email }
      : { authorized: false },
}));

vi.mock('@/lib/audit-log', () => ({
  writeAuditLog: async (entry: Record<string, unknown>) => {
    harness.auditEntries.push(entry);
  },
}));

vi.mock('@/lib/bids', () => ({
  getBidByStripeSessionId: async () => harness.resolvedPaidBid,
  getPreviousHighestBidder: async () => harness.previousBidder,
}));

const deliveryMock = vi.hoisted(() => ({
  beginDeliveryAttempt: async (bidId: string) => {
    const record = harness.deliveries.get(bidId) ?? { status: 'pending', attempts: 0 };
    record.attempts += 1;
    harness.deliveries.set(bidId, record);

    if (record.status === 'sent') {
      return { status: 'sent', attempts: record.attempts };
    }
    if (record.status === 'failed_permanent') {
      return { status: 'failed_permanent', attempts: record.attempts };
    }
    return { status: 'fresh', attempts: record.attempts };
  },
  markDeliverySent: async (bidId: string) => {
    const record = harness.deliveries.get(bidId)!;
    record.status = 'sent';
  },
  markDeliveryFailed: async (bidId: string, status: string) => {
    const record = harness.deliveries.get(bidId)!;
    record.status = status;
  },
}));

vi.mock('@/lib/notification-deliveries', () => ({
  beginDeliveryAttempt: deliveryMock.beginDeliveryAttempt,
  markDeliverySent: deliveryMock.markDeliverySent,
  markDeliveryFailed: deliveryMock.markDeliveryFailed,
}));

vi.mock('@/lib/resend', () => {
  class SendEmailError extends Error {
    constructor(public readonly kind: 'provider_rejected' | 'send_unconfirmed') {
      super(kind);
      this.name = 'SendEmailError';
    }
  }

  return {
    SendEmailError,
    sendEmail: async (params: { to: string; subject: string }) => {
      harness.emailsSent.push({ to: params.to, subject: params.subject });
      return { id: `email-${harness.emailsSent.length}` };
    },
  };
});

// Real modules under test (only their infrastructure boundaries are mocked above).
import { banEmail, isEmailBanned, listBannedEmails, unbanEmail } from './email-bans';
import {
  buildUnsubscribeUrl,
  isValidUnsubscribeTokenShape,
  isUnsubscribed,
  unsubscribeByToken,
} from './unsubscribe';
import { sendOutbidNotification } from './outbid-notification';

const CHAMP = 'champ@example.com';
const FRAUD = 'Fraud@Example.COM';
const FRAUD_CANONICAL = 'fraud@example.com';

function seedPaidBidContext() {
  harness.resolvedPaidBid = {
    bid: {
      id: 'bid-new',
      category_id: 'c1',
      amount: 150_000,
      bidder_email: 'newbidder@example.com',
      bidder_name: 'New',
    },
    category: { id: 'c1', slug: 'art', name: 'Art' },
  };
  harness.previousBidder = {
    bidId: 'bid-old',
    bidderEmail: CHAMP,
    bidderName: 'Champ',
    amount: 100_000,
  };
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://topbid.lol');
  vi.stubEnv('UNSUBSCRIBE_SECRET', 'a'.repeat(40));
  harness.tables.banned_emails = new Map();
  harness.tables.notification_unsubscribes = new Map();
  harness.writes.length = 0;
  harness.reads = 0;
  harness.lookupError = null;
  harness.admin = { authorized: true, userId: 'admin-1', email: 'admin@topbid.lol' };
  harness.auditEntries.length = 0;
  harness.deliveries.clear();
  harness.emailsSent.length = 0;
  seedPaidBidContext();
});

describe('canonical ban identity (real blocklist over in-memory store)', () => {
  it('matches every casing/whitespace variant after one canonical ban', async () => {
    await expect(banEmail(`  ${FRAUD} `)).resolves.toEqual({ ok: true, outcome: 'banned' });

    for (const variant of [
      'fraud@example.com',
      'FRAUD@EXAMPLE.COM',
      '   Fraud@Example.Com   ',
      FRAUD,
    ]) {
      await expect(isEmailBanned(variant)).resolves.toBe(true);
    }

    await expect(isEmailBanned('clean@example.com')).resolves.toBe(false);
    expect(harness.tables.banned_emails!.size).toBe(1);
    expect(harness.tables.banned_emails!.has(FRAUD_CANONICAL)).toBe(true);
  });

  it('lookup failures throw instead of admitting anyone (fail closed)', async () => {
    await banEmail(FRAUD);
    harness.lookupError = 'database unavailable';

    await expect(isEmailBanned(FRAUD)).rejects.toThrow('Failed to check ban state');
  });

  it('invalid emails resolve not-banned without touching the store', async () => {
    await expect(isEmailBanned('   ')).resolves.toBe(false);
    await expect(isEmailBanned('no-at-sign')).resolves.toBe(false);

    expect(harness.reads).toBe(0);
    expect(harness.writes).toHaveLength(0);
  });
});

describe('admin blocklist management under abuse', () => {
  it('unauthenticated callers can neither mutate nor read the blocklist', async () => {
    harness.admin.authorized = false;

    await expect(banEmail(FRAUD)).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    await expect(unbanEmail(FRAUD)).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    await expect(listBannedEmails()).resolves.toEqual({ ok: false, reason: 'unauthorized' });

    expect(harness.writes).toHaveLength(0);
    expect(harness.auditEntries).toHaveLength(0);
    expect(harness.reads).toBe(0);
  });

  it('authorization precedes input validation (shape leaks nothing)', async () => {
    harness.admin.authorized = false;

    await expect(banEmail('garbage')).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    await expect(unbanEmail('garbage')).resolves.toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('authorized bans/unbans write canonical rows and audit every outcome', async () => {
    await expect(banEmail(`  ${FRAUD} `)).resolves.toEqual({ ok: true, outcome: 'banned' });
    await expect(banEmail(FRAUD_CANONICAL)).resolves.toEqual({
      ok: true,
      outcome: 'already_banned',
    });

    expect(harness.auditEntries[0]).toMatchObject({
      action: 'banned_email.ban',
      targetType: 'banned_email',
      targetId: FRAUD_CANONICAL,
      detail: { outcome: 'banned' },
      actorUserId: 'admin-1',
    });
    expect(harness.auditEntries[1]).toMatchObject({
      action: 'banned_email.ban',
      detail: { outcome: 'already_banned' },
    });

    await expect(unbanEmail('FRAUD@example.com')).resolves.toEqual({
      ok: true,
      outcome: 'unbanned',
    });
    await expect(unbanEmail(FRAUD_CANONICAL)).resolves.toEqual({
      ok: true,
      outcome: 'not_banned',
    });

    expect(harness.auditEntries[2]).toMatchObject({
      action: 'banned_email.unban',
      detail: { outcome: 'unbanned' },
    });
    expect(harness.auditEntries[3]).toMatchObject({
      action: 'banned_email.unban',
      detail: { outcome: 'not_banned' },
    });
    expect(harness.tables.banned_emails!.size).toBe(0);
  });

  it('authorized admins cannot insert malformed addresses into the blocklist', async () => {
    await expect(banEmail('not-an-email')).resolves.toEqual({
      ok: false,
      reason: 'invalid_email',
    });

    expect(harness.writes).toHaveLength(0);
    expect(harness.auditEntries).toHaveLength(0);
  });
});

describe('outbid suppression lifecycle under adversarial retries', () => {
  function dispatch() {
    return sendOutbidNotification('cs_test_1');
  }

  it('a ban applied between redeliveries suppresses retries before consuming attempt slots', async () => {
    const first = await dispatch();

    if (!first.notified) {
      throw new Error('expected first dispatch to send');
    }
    expect(harness.emailsSent).toHaveLength(1);
    expect(harness.deliveries.get('bid-new')?.attempts).toBe(1);

    await expect(banEmail(CHAMP)).resolves.toEqual({ ok: true, outcome: 'banned' });

    // Stripe redelivers the event twice more; suppression precedes the attempt gate.
    await expect(dispatch()).resolves.toEqual({ notified: false, reason: 'recipient_banned' });
    await expect(dispatch()).resolves.toEqual({ notified: false, reason: 'recipient_banned' });

    expect(harness.emailsSent).toHaveLength(1);
    expect(harness.deliveries.get('bid-new')?.attempts).toBe(1);
  });

  it('self-outbid wins over ban and unsubscribe states (first guard)', async () => {
    harness.previousBidder = { ...harness.previousBidder!, bidderEmail: 'same@example.com' };
    harness.resolvedPaidBid!.bid.bidder_email = 'Same@Example.com';
    await banEmail('SAME@example.com');
    await unsubscribeByToken(buildUnsubscribeUrl('same@example.com')!.split('token=')[1]!);

    await expect(dispatch()).resolves.toEqual({ notified: false, reason: 'self_outbid' });
    expect(harness.emailsSent).toHaveLength(0);
  });

  it('unsubscribe consent beats a fraud ban when both apply', async () => {
    await unsubscribeByToken(getTokenFor(CHAMP));
    await banEmail(CHAMP);

    await expect(dispatch()).resolves.toEqual({
      notified: false,
      reason: 'recipient_unsubscribed',
    });
    expect(harness.emailsSent).toHaveLength(0);
    expect(harness.deliveries.size).toBe(0);
  });

  it('exactly-once gating caps unlimited redeliveries at one email even without bans', async () => {
    await dispatch();
    await dispatch();
    await dispatch();

    expect(harness.emailsSent).toHaveLength(1);
    expect(harness.deliveries.get('bid-new')?.attempts).toBeGreaterThanOrEqual(2);
  });
});

describe('unsubscribe capability tokens resist forgery and flooding', () => {
  function attackerToken(seed: string): string {
    // Deterministic 64-hex token an attacker could invent WITHOUT the server secret.
    let hex = '';

    for (let i = 0; i < 64; i += 1) {
      hex += ((seed.charCodeAt(i % seed.length) + i) % 16).toString(16);
    }

    return hex;
  }

  it('attacker-invented well-shaped tokens record harmless unknown keys only', async () => {
    const forged = attackerToken('evil');

    expect(forged).toMatch(/^[0-9a-f]{64}$/);
    await expect(unsubscribeByToken(forged)).resolves.toBe('unsubscribed');

    // The victim's suppression state is untouched: their token is derived from the
    // server-only secret, which the forged value cannot collide with.
    await expect(isUnsubscribed(CHAMP)).resolves.toBe(false);

    const dispatch = await sendOutbidNotification('cs_test_1');

    expect(dispatch).toMatchObject({ notified: true });
    expect(harness.emailsSent).toHaveLength(1);
  });

  it.each(['', 'not-a-token', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])(
    'malformed token %p is rejected without any database write',
    async (token) => {
      await expect(unsubscribeByToken(token)).rejects.toThrow('Invalid unsubscribe token');

      expect(harness.writes).toHaveLength(0);
      expect(harness.tables.notification_unsubscribes!.size).toBe(0);
    }
  );

  it('the victim can genuinely suppress notifications through their own issued link', async () => {
    const url = buildUnsubscribeUrl(`  ${CHAMP.toUpperCase()} `);

    expect(url).toMatch(/^\https:\/\/topbid\.lol\/unsubscribe\?token=[0-9a-f]{64}$/);

    const token = url!.split('token=')[1]!;

    await expect(unsubscribeByToken(token)).resolves.toBe('unsubscribed');
    await expect(unsubscribeByToken(token)).resolves.toBe('already_unsubscribed');

    await expect(sendOutbidNotification('cs_test_1')).resolves.toEqual({
      notified: false,
      reason: 'recipient_unsubscribed',
    });
    expect(harness.emailsSent).toHaveLength(0);
  });

  it('shape validation rejects non-string input before any storage access', () => {
    expect(isValidUnsubscribeTokenShape(null)).toBe(false);
    expect(isValidUnsubscribeTokenShape(undefined)).toBe(false);
    expect(isValidUnsubscribeTokenShape(123)).toBe(false);
    expect(harness.reads).toBe(0);
  });
});

function getTokenFor(email: string): string {
  return buildUnsubscribeUrl(email)!.split('token=')[1]!;
}
