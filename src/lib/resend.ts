import { Resend } from 'resend';

/**
 * Server-only Resend email integration (Task 6.2, adjusted by Task 6.4).
 *
 * - RESEND_API_KEY and RESEND_FROM_EMAIL are server-only environment variables (no
 *   NEXT_PUBLIC_ prefix); this module must never be imported by client code
 * - Configuration is validated with descriptive errors on first use (lazily memoized
 *   client) - a misconfigured provider fails loudly at send time and NEVER silently
 *   pretends an email was delivered. Validation deliberately happens at use rather
 *   than module load: Next.js evaluates API route modules while collecting build/page
 *   data, so a module-scope throw would break every production build on machines or
 *   previews where email is not configured yet (surfaced when Task 6.4 wired the
 *   webhook route to the notification flow)
 * - Task 6.3 (templates) and Task 6.4 (outbid notification flow) compose on top of the
 *   sendEmail boundary; no notification business logic lives here
 */

let cachedClient: Resend | null = null;
let cachedFromAddress: string | null = null;

function ensureConfigured(): { client: Resend; fromAddress: string } {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    throw new Error('Missing RESEND_API_KEY environment variable');
  }

  const fromAddress = process.env.RESEND_FROM_EMAIL;

  if (!fromAddress || !fromAddress.trim()) {
    throw new Error('Missing RESEND_FROM_EMAIL environment variable');
  }

  const trimmedFrom = fromAddress.trim();

  if (!cachedClient || cachedFromAddress !== trimmedFrom) {
    cachedClient = new Resend(apiKey);
    cachedFromAddress = trimmedFrom;
  }

  return { client: cachedClient, fromAddress: trimmedFrom };
}

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /**
   * Optional transport headers (Task 6.6: List-Unsubscribe / List-Unsubscribe-Post).
   * Purely additive and optional - omitted keeps the provider payload unchanged.
   */
  headers?: Record<string, string>;
};

export type SentEmail = {
  id: string;
};

/**
 * Classification of the two REAL failure modes of this integration (Task 6.7):
 * - 'provider_rejected': Resend answered and rejected the request (invalid recipient,
 *   from address, configuration) - the email was definitively NOT sent, so failures of
 *   this kind are terminal
 * - 'send_unconfirmed': the transport threw before a provider answer arrived
 *   (timeout, connection failure) - the outcome is unknown, so callers may retry while
 *   accepting standard at-least-once email semantics
 */
export type SendEmailErrorKind = 'provider_rejected' | 'send_unconfirmed';

export class SendEmailError extends Error {
  readonly kind: SendEmailErrorKind;

  constructor(message: string, kind: SendEmailErrorKind) {
    super(message);
    this.name = 'SendEmailError';
    this.kind = kind;
  }
}

/**
 * Send an email through Resend. Returns the provider message id on success; throws a
 * descriptive error on provider failure so callers never mistake a failed send for a
 * delivered one.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  headers,
}: SendEmailParams): Promise<SentEmail> {
  const { client, fromAddress } = ensureConfigured();

  try {
    const { data, error } = await client.emails.send({
      from: fromAddress,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(headers ? { headers } : {}),
    });

    if (error) {
      // Resend answered and rejected the request: definitively not sent.
      throw new SendEmailError(`Failed to send email: ${error.message}`, 'provider_rejected');
    }

    if (!data) {
      // No answer and no rejection: outcome unknown.
      throw new SendEmailError('Failed to send email: provider returned no id', 'send_unconfirmed');
    }

    return { id: data.id };
  } catch (cause) {
    // Classified failures pass through untouched; any transport throw that escaped the
    // SDK (timeout, connection failure) failed before a provider answer arrived.
    if (cause instanceof SendEmailError) {
      throw cause;
    }

    const message = cause instanceof Error ? cause.message : String(cause);

    throw new SendEmailError(`Failed to send email: ${message}`, 'send_unconfirmed');
  }
}
