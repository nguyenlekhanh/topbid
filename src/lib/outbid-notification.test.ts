import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendOutbidNotification } from './outbid-notification';
import { buildOutbidEmail } from './outbid-email-template';

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

vi.mock('@/lib/bids', () => ({
  getBidByStripeSessionId: bidsMock.getBidByStripeSessionId,
  getPreviousHighestBidder: bidsMock.getPreviousHighestBidder,
}));

vi.mock('@/lib/resend', () => ({
  sendEmail: resendMock.sendEmail,
}));

vi.mock('@/lib/unsubscribe', () => ({
  isUnsubscribed: unsubscribeMock.isUnsubscribed,
  buildUnsubscribeUrl: unsubscribeMock.buildUnsubscribeUrl,
  listUnsubscribeHeaders: unsubscribeMock.listUnsubscribeHeaders,
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
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
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

  it('propagates provider failures instead of pretending delivery succeeded', async () => {
    resendMock.sendEmail.mockRejectedValue(new Error('Failed to send email: invalid from address'));

    await expect(sendOutbidNotification('cs_new')).rejects.toThrow(
      'Failed to send email: invalid from address'
    );

    expect(bidsMock.getPreviousHighestBidder).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when the base URL needed for the CTA is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    await expect(sendOutbidNotification('cs_new')).rejects.toThrow(
      'Missing NEXT_PUBLIC_APP_URL: required to build the bid-again link'
    );
    expect(resendMock.sendEmail).not.toHaveBeenCalled();
  });
});
