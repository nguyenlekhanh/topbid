import { describe, expect, it } from 'vitest';

import { buildOutbidEmail } from './outbid-email-template';
import type { SendEmailParams } from './resend';

const BASE_INPUT = {
  to: 'outbid@example.com',
  bidderName: 'Alex Chen',
  categoryName: 'Art & Collectibles',
  previousAmount: 125000,
  newAmount: 150000,
  newBidderName: 'Sarah M.',
};

describe('buildOutbidEmail', () => {
  it('builds a subject containing the category name', () => {
    const email = buildOutbidEmail(BASE_INPUT);

    expect(email.subject).toBe("You've been outbid on Art & Collectibles!");
  });

  it('returns the recipient address unchanged', () => {
    const email = buildOutbidEmail(BASE_INPUT);

    expect(email.to).toBe('outbid@example.com');
  });

  it('formats both amounts as currency in the HTML body', () => {
    const email = buildOutbidEmail(BASE_INPUT);

    expect(email.html).toContain('$1,250');
    expect(email.html).toContain('$1,500');
  });

  it('includes the category and new bidder in the HTML body', () => {
    const email = buildOutbidEmail(BASE_INPUT);

    expect(email.html).toContain('Art &amp; Collectibles');
    expect(email.html).toContain('Sarah M.');
  });

  it('greets the outbid bidder by name', () => {
    const email = buildOutbidEmail(BASE_INPUT);

    expect(email.html).toContain('Hi Alex Chen,');
    expect(email.text).toContain('Hi Alex Chen,');
  });

  it('falls back to a generic greeting when bidder name is null', () => {
    const email = buildOutbidEmail({ ...BASE_INPUT, bidderName: null });

    expect(email.html).toContain('Hi there,');
    expect(email.text).toContain('Hi there,');
  });

  it('falls back to a generic label when the new bidder name is null or blank', () => {
    const nullCase = buildOutbidEmail({ ...BASE_INPUT, newBidderName: null });
    const blankCase = buildOutbidEmail({ ...BASE_INPUT, newBidderName: '   ' });

    expect(nullCase.text).toContain('Another bidder');
    expect(blankCase.text).toContain('Another bidder');
  });

  it('escapes HTML-sensitive characters in dynamic values (XSS-safe)', () => {
    const malicious = buildOutbidEmail({
      ...BASE_INPUT,
      categoryName: '<script>alert("x")</script>',
      newBidderName: '<img src=x onerror=alert(1)>',
    });

    expect(malicious.html).not.toContain('<script>');
    expect(malicious.html).not.toContain('<img src=x');
    expect(malicious.html).toContain('&lt;script&gt;');
    expect(malicious.subject).toContain('<script>alert("x")</script>'); // subjects are plain text
  });

  it('produces a plain-text body without HTML tags', () => {
    const email = buildOutbidEmail(BASE_INPUT);

    expect(email.text).not.toContain('<');
    expect(email.text).not.toContain('>');
    expect(email.text).toContain('$1,250');
    expect(email.text).toContain('$1,500');
  });

  it('is deterministic for identical input', () => {
    const first = buildOutbidEmail(BASE_INPUT);
    const second = buildOutbidEmail(BASE_INPUT);

    expect(first).toEqual(second);
  });

  it('matches the sendEmail parameter contract shape', () => {
    const email = buildOutbidEmail(BASE_INPUT);
    const sendShape: SendEmailParams = email;

    expect(Object.keys(sendShape).sort()).toEqual(['html', 'subject', 'text', 'to']);
  });

  it('contains no bid-again link (Task 6.5 owns that scope)', () => {
    const email = buildOutbidEmail(BASE_INPUT);

    expect(email.html.toLowerCase()).not.toContain('href');
    expect(email.html.toLowerCase()).not.toContain('http');
    expect(email.text.toLowerCase()).not.toContain('http');
  });
});
