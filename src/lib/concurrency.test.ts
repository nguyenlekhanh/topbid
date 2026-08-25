import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBid: vi.fn(),
  getPrev: vi.fn(),
  sendEmail: vi.fn(),
  unsubCheck: vi.fn(),
  unsubUrl: vi.fn(),
  unsubHeaders: vi.fn(),
  beginAttempt: vi.fn(),
  markSent: vi.fn(),
  markFailed: vi.fn(),
  banCheck: vi.fn(),
}));

vi.mock('@/lib/bids', () => ({
  getBidByStripeSessionId: mocks.getBid,
  getPreviousHighestBidder: mocks.getPrev,
}));
vi.mock('@/lib/resend', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/lib/unsubscribe', () => ({
  isUnsubscribed: mocks.unsubCheck,
  buildUnsubscribeUrl: mocks.unsubUrl,
  listUnsubscribeHeaders: mocks.unsubHeaders,
}));
vi.mock('@/lib/notification-deliveries', () => ({
  beginDeliveryAttempt: mocks.beginAttempt,
  markDeliverySent: mocks.markSent,
  markDeliveryFailed: mocks.markFailed,
}));
vi.mock('@/lib/email-bans', () => ({ isEmailBanned: mocks.banCheck }));

import { sendOutbidNotification } from './outbid-notification';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://topbid.lol');
  mocks.getBid.mockResolvedValue({
    bid: {
      id: 'bid-1',
      category_id: 'c1',
      amount: 100000,
      bidder_email: 'new@b.com',
      bidder_name: 'New',
      stripe_session_id: 'cs_1',
      stripe_payment_intent_id: 'pi_1',
      status: 'paid',
      is_highest: true,
      created_at: '',
      paid_at: '',
    },
    category: { id: 'c1', slug: 'art', name: 'Art' },
  });
  mocks.getPrev.mockResolvedValue({
    bidId: 'b0',
    bidderEmail: 'champ@t.com',
    bidderName: 'C',
    amount: 90000,
  });
  mocks.sendEmail.mockResolvedValue({ id: 'e1' });
  mocks.unsubCheck.mockResolvedValue(false);
  mocks.unsubUrl.mockReturnValue('https://x/unsubscribe?token=t');
  mocks.unsubHeaders.mockReturnValue({ 'List-Unsubscribe': '<u>', 'List-Unsubscribe-Post': 'O' });
  mocks.beginAttempt.mockResolvedValue({ status: 'fresh', attempts: 1 });
  mocks.markSent.mockResolvedValue(undefined);
  mocks.markFailed.mockResolvedValue(undefined);
  mocks.banCheck.mockResolvedValue(false);
});

describe('concurrent dispatch gating (Task 9.8)', () => {
  it('exactly one of two concurrent calls sends; other gated to already_sent', async () => {
    let n = 0;
    mocks.beginAttempt.mockImplementation(async () => {
      n++;
      return n === 1 ? { status: 'fresh', attempts: 1 } : { status: 'sent' };
    });

    const [a, b] = await Promise.all([sendOutbidNotification('cs'), sendOutbidNotification('cs')]);

    expect(a.notified !== b.notified).toBe(true);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const sentResult = [a, b].find((r) => r.notified);
    expect(sentResult).toBeDefined();
  });
});
