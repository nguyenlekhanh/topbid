import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resendMock = vi.hoisted(() => {
  const send = vi.fn();
  const constructedWith: Array<string | undefined> = [];

  return { send, constructedWith };
});

vi.mock('resend', () => ({
  Resend: class {
    emails: { send: typeof resendMock.send };

    constructor(apiKey?: string) {
      resendMock.constructedWith.push(apiKey);
      this.emails = { send: resendMock.send };
    }
  },
}));

// Task 6.2 originally validated at module load; Task 6.4 moved validation to first use
// because Next.js evaluates route modules during build page-data collection. The
// descriptive-error contract is unchanged - it now surfaces from sendEmail.
type ResendModule = typeof import('./resend');

async function importResendModule(): Promise<ResendModule> {
  // Clear the ESM cache so each import re-evaluates against the currently stubbed
  // environment variables and starts with a fresh memoized client.
  vi.resetModules();

  return import('./resend');
}

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
  vi.stubEnv('RESEND_FROM_EMAIL', 'Topbid <noreply@topbid.lol>');
  resendMock.send.mockReset();
  resendMock.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  resendMock.constructedWith.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resend email integration (Task 6.2)', () => {
  it('rejects sending when RESEND_API_KEY is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '');

    const { sendEmail } = await importResendModule();

    await expect(sendEmail({ to: 'a@b.com', subject: 'S', html: '<p>H</p>' })).rejects.toThrow(
      'Missing RESEND_API_KEY environment variable'
    );
  });

  it('rejects sending when the API key is whitespace-only', async () => {
    vi.stubEnv('RESEND_API_KEY', '   ');

    const { sendEmail } = await importResendModule();

    await expect(sendEmail({ to: 'a@b.com', subject: 'S', html: '<p>H</p>' })).rejects.toThrow(
      'Missing RESEND_API_KEY environment variable'
    );
  });

  it('rejects sending when RESEND_FROM_EMAIL is missing', async () => {
    vi.stubEnv('RESEND_FROM_EMAIL', '');

    const { sendEmail } = await importResendModule();

    await expect(sendEmail({ to: 'a@b.com', subject: 'S', html: '<p>H</p>' })).rejects.toThrow(
      'Missing RESEND_FROM_EMAIL environment variable'
    );
  });

  it('constructs the client with the configured API key on first send', async () => {
    const { sendEmail } = await importResendModule();

    const result = await sendEmail({
      to: 'outbid@example.com',
      subject: 'You have been outbid',
      html: '<p>Someone outbid you</p>',
    });

    expect(result).toEqual({ id: 'email-1' });
    expect(resendMock.constructedWith).toEqual(['re_test_key']);
  });

  it('memoizes the client across sends with an unchanged sender address', async () => {
    const { sendEmail } = await importResendModule();

    await sendEmail({ to: 'a@b.com', subject: 'S', html: '<p>H</p>' });
    await sendEmail({ to: 'c@d.com', subject: 'S2', html: '<p>H2</p>' });

    expect(resendMock.constructedWith).toEqual(['re_test_key']);
    expect(resendMock.send).toHaveBeenCalledTimes(2);
  });

  it('reconfigures the client when the sender address changes', async () => {
    const { sendEmail } = await importResendModule();

    await sendEmail({ to: 'a@b.com', subject: 'S', html: '<p>H</p>' });

    vi.stubEnv('RESEND_FROM_EMAIL', 'Topbid <bounce@topbid.lol>');

    await sendEmail({ to: 'a@b.com', subject: 'S', html: '<p>H</p>' });

    expect(resendMock.constructedWith).toEqual(['re_test_key', 're_test_key']);
  });

  it('sends with the configured sender and exact recipient/subject/body params', async () => {
    const { sendEmail } = await importResendModule();

    const result = await sendEmail({
      to: 'outbid@example.com',
      subject: 'You have been outbid',
      html: '<p>Someone outbid you</p>',
    });

    expect(result).toEqual({ id: 'email-1' });
    expect(resendMock.send).toHaveBeenCalledWith({
      from: 'Topbid <noreply@topbid.lol>',
      to: 'outbid@example.com',
      subject: 'You have been outbid',
      html: '<p>Someone outbid you</p>',
    });
  });

  it('includes the optional text body when provided', async () => {
    const { sendEmail } = await importResendModule();

    await sendEmail({
      to: 'outbid@example.com',
      subject: 'S',
      html: '<p>H</p>',
      text: 'Plain text body',
    });

    expect(resendMock.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Plain text body' })
    );
  });

  it('omits the text field entirely when not provided', async () => {
    const { sendEmail } = await importResendModule();

    await sendEmail({ to: 'a@b.com', subject: 'S', html: '<p>H</p>' });

    const callArgs = resendMock.send.mock.calls[0][0] as Record<string, unknown>;
    expect('text' in callArgs).toBe(false);
  });

  it('propagates provider failures as descriptive errors', async () => {
    resendMock.send.mockResolvedValue({
      data: null,
      error: { message: 'invalid from address' },
    });

    const { sendEmail } = await importResendModule();

    await expect(sendEmail({ to: 'a@b.com', subject: 'S', html: '<p>H</p>' })).rejects.toThrow(
      'Failed to send email: invalid from address'
    );
  });
});
