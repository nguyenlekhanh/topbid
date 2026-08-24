import { Resend } from 'resend';

/**
 * Server-only Resend email integration (Task 6.2).
 *
 * - RESEND_API_KEY and RESEND_FROM_EMAIL are server-only environment variables (no
 *   NEXT_PUBLIC_ prefix); this module must never be imported by client code
 * - Configuration is validated eagerly at module load with descriptive errors - a
 *   misconfigured email provider must fail loudly at boot, never silently pretend an
 *   email was sent mid-request
 * - Task 6.3 (templates) and Task 6.4 (outbid notification flow) will compose on top of
 *   the sendEmail boundary; no notification business logic lives here
 */

if (!process.env.RESEND_API_KEY || !process.env.RESEND_API_KEY.trim()) {
  throw new Error('Missing RESEND_API_KEY environment variable');
}

const apiKey = process.env.RESEND_API_KEY;

if (!process.env.RESEND_FROM_EMAIL || !process.env.RESEND_FROM_EMAIL.trim()) {
  throw new Error('Missing RESEND_FROM_EMAIL environment variable');
}

const fromAddress = process.env.RESEND_FROM_EMAIL.trim();

export const resend = new Resend(apiKey);

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type SentEmail = {
  id: string;
};

/**
 * Send an email through Resend. Returns the provider message id on success; throws a
 * descriptive error on provider failure so callers never mistake a failed send for a
 * delivered one.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<SentEmail> {
  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject,
    html,
    ...(text ? { text } : {}),
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return { id: data.id };
}
