import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendOutbidNotification } from './outbid-notification';
import { buildOutbidEmail } from './outbid-email-template';

/**
 * The mocked Resend boundary exports a stand-in SendEmailError so the orchestrator's
 * `instanceof` classification works against the SAME constructor the tests throw.
 */
type ResendModule = typeof import('./resend');

/**
 * Task 6.4 — deterministic tests for the notification orchestration.
 *
 * The database boundaries (bids queries) and the email provider boundary (Resend) are
 * both mocked at module level; the pure Task 6.3 template runs genuinely so the exact
 * composed content can be asserted. No real network or email delivery occurs.
 */

const bidsMock = vi.hoisted(() => ({
  getBidByStripeSessionId: vi.fn(),
  getPreviousHighestBidder: vi.fn(),
}));

const resendMock = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

const unsubscribeMock = vi.hoisted(() => ({
  isUnsubscribed: vi.fn(),
  buildUnsubscribeUrl: vi.fn(),
  listUnsubscribeHeaders: vi.fn(),
}));

const deliveriesMock = vi.hoisted(() => ({
  beginDeliveryAttempt: vi.fn(),
  markDeliverySent: vi.fn(),
  markDeliveryFailed: vi.fn(),
}));

vi.mock('@/lib/bids', () => ({
  getBidByStripeSessionId: bidsMock.getBidByStripeSessionId,
  getPreviousHighestBidder: bidsMock.getPreviousHighestBidder,
}));

vi.mock('@/lib/resend', () => {
  class SendEmailError extends Error {
    kind: string;

    constructor(message: string, kind: string) {
      super(message);
      this.name = 'SendEmailError';
      this.kind = kind;
    }
  }

  return { sendEmail: resendMock.sendEmail, SendEmailError };
});

async function getResendModule(): Promise<ResendModule> {
  return import('@/lib/resend');
}

vi.mock('@/lib/unsubscribe', () => ({
  isUnsubscribed: unsubscribeMock.isUnsubscribed,
  buildUnsubscribeUrl: unsubscribeMock.buildUnsubscribeUrl,
  listUnsubscribeHeaders: unsubscribeMock.listUnsubscribeHeaders,
}));

vi.mock('@/lib/notification-deliveries', () => ({
  beginDeliveryAttempt: deliveriesMock.beginDeliveryAttempt,
  markDeliverySent: deliveriesMock.markDeliverySent,
  markDeliveryFailed: deliveriesMock.markDeliveryFailed,
}));

const emailBansMock = vi.hoisted(() => ({
  isEmailBanned: vi.fn(),
}));

vi.mock('@/lib/email-bans', () => ({
  isEmailBanned: emailBansMock.isEmailBanned,
}));

const CATEGORY = { id: 'cat-1', slug: 'retro-gaming', name: 'Retro Gaming' };

const NEW_BID_ROW = {
  id: 'bid-new',
  category_id: 'cat-1',
  amount: 150000,
  bidder_email: 'challenger@example.com',
  bidder_name: 'Challenger',
  stripe_session_id: 'cs_new',
  stripe_payment_intent_id: 'pi_new',
  status: 'paid',
  is_highest: true,
  created_at: '2026-08-24T00:00:00Z',
  paid_at: '2026-08-24T00:00:00Z',
};

const PREVIOUS_BIDDER = {
  bidId: 'bid-prev',
  bidderEmail: 'champ@example.com',
  bidderName: 'Champ',
  amount: 125000,
};

const APP_URL = 'https://topbid.lol';
const BID_AGAIN_URL = `${APP_URL}/#categories-heading`;
const UNSUBSCRIBE_TOKEN = 'f'.repeat(64);
const UNSUBSCRIBE_URL = `${APP_URL}/unsubscribe?token=${UNSUBSCRIBE_TOKEN}`;
const LIST_UNSUBSCRIBE_HEADERS = {
  'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  bidsMock.getBidByStripeSessionId.mockReset();
  bidsMock.getBidByStripeSessionId.mockResolvedValue({ bid: NEW_BID_ROW, category: CATEGORY });
  bidsMock.getPreviousHighestBidder.mockReset();
  bidsMock.getPreviousHighestBidder.mockResolvedValue(PREVIOUS_BIDDER);
  resendMock.sendEmail.mockReset();
  resendMock.sendEmail.mockResolvedValue({ id: 'email-123' });
  unsubscribeMock.isUnsubscribed.mockReset();
  unsubscribeMock.isUnsubscribed.mockResolvedValue(false);
  unsubscribeMock.buildUnsubscribeUrl.mockReset();
  unsubscribeMock.buildUnsubscribeUrl.mockReturnValue(UNSUBSCRIBE_URL);
  unsubscribeMock.listUnsubscribeHeaders.mockReset();
  unsubscribeMock.listUnsubscribeHeaders.mockReturnValue(LIST_UNSUBSCRIBE_HEADERS);
  deliveriesMock.beginDeliveryAttempt.mockReset();
  deliveriesMock.beginDeliveryAttempt.mockResolvedValue({ status: 'fresh', attempts: 1 });
  emailBansMock.isEmailBanned.mockReset();
  emailBansMock.isEmailBanned.mockResolvedValue(false);
  deliveriesMock.markDeliverySent.mockReset();
  deliveriesMock.markDeliverySent.mockResolvedValue(undefined);
  deliveriesMock.markDeliveryFailed.mockReset();
  deliveriesMock.markDeliveryFailed.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sendOutbidNotification (Task 6.4)', () => {
  it('detects the previous highest bidder via the authoritative query excluding the new bid', async () => {
    await sendOutbidNotification('cs_new');

    expect(bidsMock.getBidByStripeSessionId).toHaveBeenCalledWith('cs_new');
    expect(bidsMock.getPreviousHighestBidder).toHaveBeenCalledWith('cat-1', 'bid-new');
    expect(bidsMock.getPreviousHighestBidder).toHaveBeenCalledTimes(1);
  });

  it('sends exactly the template-composed content through the sendEmail boundary', async () => {
    const result = await sendOutbidNotification('cs_new');

    const expectedContent = {
      ...buildOutbidEmail({
        to: 'champ@example.com',
        bidderName: 'Champ',
        categoryName: 'Retro Gaming',
        previousAmount: 125000,
        newAmount: 150000,
        newBidderName: 'Challenger',
        bidAgainUrl: BID_AGAIN_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
      headers: LIST_UNSUBSCRIBE_HEADERS,
    };

    expect(resendMock.sendEmail).toHaveBeenCalledTimes(1);
    expect(resendMock.sendEmail).toHaveBeenCalledWith(expectedContent);
    expect(unsubscribeMock.listUnsubscribeHeaders).toHaveBeenCalledWith(UNSUBSCRIBE_URL);
    expect(deliveriesMock.beginDeliveryAttempt).toHaveBeenCalledWith('bid-new');
    expect(deliveriesMock.markDeliverySent).toHaveBeenCalledWith('bid-new', 'email-123');

    expect(result).toEqual({
      notified: true,
      recipient: 'champ@example.com',
      messageId: 'email-123',
    });
  });

  it('includes the bid-again CTA in the delivered email (Task 6.5)', async () => {
    await sendOutbidNotification('cs_new');

    const content = resendMock.sendEmail.mock.calls[0][0] as { html: string; text: string };

    expect(content.html).toContain(
      '<a href="https://topbid.lol/#categories-heading">Bid again</a>'
    );
    expect(content.text).toContain('Bid again: https://topbid.lol/#categories-heading');
  });

  it('includes the unsubscribe footer and transport headers (Task 6.6)', async () => {
    await sendOutbidNotification('cs_new');

    expect(unsubscribeMock.buildUnsubscribeUrl).toHaveBeenCalledWith('champ@example.com');

    const content = resendMock.sendEmail.mock.calls[0][0] as {
      html: string;
      text: string;
      headers: Record<string, string>;
    };

    expect(content.html).toContain(`<a href="${UNSUBSCRIBE_URL}">Unsubscribe</a>`);
    expect(content.text).toContain(`Don't want these emails? Unsubscribe: ${UNSUBSCRIBE_URL}`);
    expect(content.headers).toEqual(LIST_UNSUBSCRIBE_HEADERS);
  });

  it('never emails a recipient who has unsubscribed', async () => {
    unsubscribeMock.isUnsubscribed.mockResolvedValue(true);

    const result = await sendOutbidNotification('cs_new');

    expect(unsubscribeMock.isUnsubscribed).toHaveBeenCalledWith('champ@example.com');
    expect(result).toEqual({ notified: false, reason: 'recipient_unsubscribed' });
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
  });

  it('still reports self_outbid before consulting suppression state', async () => {
    bidsMock.getPreviousHighestBidder.mockResolvedValue({
      ...PREVIOUS_BIDDER,
      bidderEmail: 'CHALLENGER@Example.com',
    });

    const result = await sendOutbidNotification('cs_self');

    expect(result).toEqual({ notified: false, reason: 'self_outbid' });
    expect(unsubscribeMock.isUnsubscribed).not.toHaveBeenCalled();
    expect(emailBansMock.isEmailBanned).not.toHaveBeenCalled();
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
  });

  it('never emails a fraud-banned recipient (Task 8.7)', async () => {
    emailBansMock.isEmailBanned.mockResolvedValue(true);

    const result = await sendOutbidNotification('cs_new');

    expect(emailBansMock.isEmailBanned).toHaveBeenCalledWith('champ@example.com');
    expect(result).toEqual({ notified: false, reason: 'recipient_banned' });
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
  });

  it('checks unsubscribe suppression on retry attempts too (Task 6.7 x 6.6)', async () => {
    deliveriesMock.beginDeliveryAttempt.mockResolvedValue({ status: 'retry', attempts: 2 });
    unsubscribeMock.isUnsubscribed.mockResolvedValue(true);

    const result = await sendOutbidNotification('cs_new');

    expect(result).toEqual({ notified: false, reason: 'recipient_unsubscribed' });
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
    // Suppression runs BEFORE the attempt gate, so no new attempt is recorded either.
    expect(deliveriesMock.beginDeliveryAttempt).not.toHaveBeenCalled();
    expect(deliveriesMock.markDeliveryFailed).not.toHaveBeenCalled();
  });

  it('normalizes a trailing slash on the configured base URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://topbid.lol/');

    await sendOutbidNotification('cs_new');

    const content = resendMock.sendEmail.mock.calls[0][0] as { html: string };

    expect(content.html).toContain(`href="${BID_AGAIN_URL}"`);
  });

  it('composes from authoritative amounts and null names without inventing data', async () => {
    bidsMock.getPreviousHighestBidder.mockResolvedValue({
      bidId: 'bid-prev',
      bidderEmail: 'champ@example.com',
      bidderName: null,
      amount: 9900,
    });
    bidsMock.getBidByStripeSessionId.mockResolvedValue({
      bid: { ...NEW_BID_ROW, bidder_name: null },
      category: CATEGORY,
    });

    await sendOutbidNotification('cs_new');

    expect(resendMock.sendEmail).toHaveBeenCalledWith({
      ...buildOutbidEmail({
        to: 'champ@example.com',
        bidderName: null,
        categoryName: 'Retro Gaming',
        previousAmount: 9900,
        newAmount: 150000,
        newBidderName: null,
        bidAgainUrl: BID_AGAIN_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
      headers: LIST_UNSUBSCRIBE_HEADERS,
    });
  });

  it.each(['', '   '])(
    'skips without any query when the session identifier is %p',
    async (sessionId) => {
      const result = await sendOutbidNotification(sessionId);

      expect(result).toEqual({ notified: false, reason: 'new_bid_not_found' });
      expect(bidsMock.getBidByStripeSessionId).not.toHaveBeenCalled();
      expect(bidsMock.getPreviousHighestBidder).not.toHaveBeenCalled();
      expect(resendMock.sendEmail).not.toHaveBeenCalled();
    }
  );

  it('skips when no paid bid is visible for the session yet', async () => {
    bidsMock.getBidByStripeSessionId.mockResolvedValue(null);

    const result = await sendOutbidNotification('cs_unknown');

    expect(result).toEqual({ notified: false, reason: 'new_bid_not_found' });
    expect(bidsMock.getPreviousHighestBidder).not.toHaveBeenCalled();
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
  });

  it('skips when the resolved bid has no readable category name', async () => {
    bidsMock.getBidByStripeSessionId.mockResolvedValue({ bid: NEW_BID_ROW, category: null });

    const result = await sendOutbidNotification('cs_new');

    expect(result).toEqual({ notified: false, reason: 'new_bid_not_found' });
    expect(bidsMock.getPreviousHighestBidder).not.toHaveBeenCalled();
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
  });

  it('does not email anyone when the outbidding bid was the first paid bid', async () => {
    bidsMock.getPreviousHighestBidder.mockResolvedValue(null);

    const result = await sendOutbidNotification('cs_first');

    expect(result).toEqual({ notified: false, reason: 'no_previous_bidder' });
    expect(bidsMock.getPreviousHighestBidder).toHaveBeenCalledWith('cat-1', 'bid-new');
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
  });

  it('never notifies the bidder who just became highest again (case-insensitive match)', async () => {
    bidsMock.getPreviousHighestBidder.mockResolvedValue({
      ...PREVIOUS_BIDDER,
      bidderEmail: 'CHALLENGER@Example.com',
    });

    const result = await sendOutbidNotification('cs_self');

    expect(result).toEqual({ notified: false, reason: 'self_outbid' });
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
  });

  it('classifies transport-unconfirmed provider failures as retryable (Task 6.7)', async () => {
    const { SendEmailError } = await getResendModule();

    resendMock.sendEmail.mockRejectedValue(
      new SendEmailError('Failed to send email: fetch failed', 'send_unconfirmed')
    );

    const result = await sendOutbidNotification('cs_new');

    expect(result).toEqual({
      notified: false,
      reason: 'send_failed',
      retryable: true,
      attempts: 1,
    });
    expect(deliveriesMock.markDeliveryFailed).toHaveBeenCalledWith(
      'bid-new',
      'failed_retryable',
      'Failed to send email: fetch failed'
    );
    expect(deliveriesMock.markDeliverySent).not.toHaveBeenCalled();
  });

  it('classifies provider rejections as terminal (Task 6.7)', async () => {
    const { SendEmailError } = await getResendModule();

    resendMock.sendEmail.mockRejectedValue(
      new SendEmailError('Failed to send email: invalid recipient', 'provider_rejected')
    );

    const result = await sendOutbidNotification('cs_new');

    expect(result).toEqual({
      notified: false,
      reason: 'send_failed',
      retryable: false,
      attempts: 1,
    });
    expect(deliveriesMock.markDeliveryFailed).toHaveBeenCalledWith(
      'bid-new',
      'failed_permanent',
      'Failed to send email: invalid recipient'
    );
  });

  it('rethrows unexpected infrastructure errors instead of faking a handled send', async () => {
    deliveriesMock.markDeliverySent.mockRejectedValue(new Error('database unavailable'));

    await expect(sendOutbidNotification('cs_new')).rejects.toThrow('database unavailable');
  });

  it('never resends when the delivery for this bid was already recorded as sent', async () => {
    deliveriesMock.beginDeliveryAttempt.mockResolvedValue({ status: 'sent' });

    const result = await sendOutbidNotification('cs_new');

    expect(result).toEqual({ notified: false, reason: 'already_sent' });
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
    expect(deliveriesMock.markDeliverySent).not.toHaveBeenCalled();
  });

  it('stops retrying terminally failed deliveries without sending again', async () => {
    deliveriesMock.beginDeliveryAttempt.mockResolvedValue({ status: 'failed_permanent' });

    const result = await sendOutbidNotification('cs_new');

    expect(result).toEqual({ notified: false, reason: 'already_handled' });
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
  });

  it('retries unconfirmed failures on later attempts with incremented attempt count', async () => {
    deliveriesMock.beginDeliveryAttempt.mockResolvedValue({ status: 'retry', attempts: 3 });

    const result = await sendOutbidNotification('cs_new');

    expect(result).toEqual({
      notified: true,
      recipient: 'champ@example.com',
      messageId: 'email-123',
    });
    expect(resendMock.sendEmail).toHaveBeenCalledTimes(1);
    expect(unsubscribeMock.isUnsubscribed).toHaveBeenCalledWith('champ@example.com');
  });

  it('fails loudly when the base URL needed for the CTA is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    await expect(sendOutbidNotification('cs_new')).rejects.toThrow(
      'Missing NEXT_PUBLIC_APP_URL: required to build the bid-again link'
    );
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
  });
});
