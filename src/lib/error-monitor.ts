// Type-only import: erased at runtime, so the SDK is still loaded lazily/optionally.
import type { ExclusiveEventHintOrCaptureContext } from '@sentry/nextjs';

/**
 * Error-monitoring adapter (Task 10.7).
 *
 * Observational only: this module NEVER influences authorization, payment state,
 * bidding, Stripe webhook processing, refunds, unsubscribe, notification delivery, or
 * admin operations. Every Sentry interaction is lazily imported, guarded, and
 * swallow-all - a monitoring outage can never replace or alter the original
 * application error.
 *
 * Expected business outcomes deliberately DO NOT pass through here: typed results like
 * provider_failed / db_pending / refund_submitted, validation and authorization
 * refusals, rate limits, duplicate/idempotent outcomes, and known payment states keep
 * their existing console-based logging (Task 9.11 audit). Only UNHANDLED exceptions
 * that escape Next.js reach reportRequestError via src/instrumentation.ts.
 *
 * Privacy contract (enforced by construction - nothing else is ever passed to the SDK):
 * - request URLs are sanitized (query string + hash stripped) so session ids
 *   (/success?session_id=...) and capability tokens (/unsubscribe?token=...) can never
 *   be transmitted
 * - no headers, cookies, request bodies, webhook payloads, credentials, tokens, or
 *   environment values are ever forwarded; sendDefaultPii is explicitly false
 * - the source-map upload credential is build-only (read exclusively inside
 *   next.config.ts) and is never referenced anywhere in application code
 */

type MinimalRequest = {
  url?: unknown;
  method?: unknown;
};

type MinimalErrorContext = {
  routerPath?: unknown;
  headers?: unknown;
  cookies?: unknown;
  search?: unknown;
} & Record<string, unknown>;

/** Strip query string and fragment from any URL-ish input; null when unusable. */
export function sanitizeErrorUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) {
    return null;
  }

  try {
    const parsed = new URL(url);

    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Relative paths ("http://missing-host" style inputs from edge cases) - strip the
    // query/hash textually rather than failing.
    const withoutQuery = url.split('?')[0]?.trim();

    return withoutQuery ? withoutQuery : null;
  }
}

function allowedDsn(): string | null {
  const dsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || '';

  return dsn || null;
}

let initialized = false;

/**
 * Server/Edge initialization for src/instrumentation.ts register(). No-op unless a DSN
 * is configured, keeping builds/tests/dev fully green without credentials.
 */
export async function initErrorMonitor(): Promise<void> {
  const dsn = allowedDsn();

  if (!dsn || initialized) {
    return;
  }

  try {
    const Sentry = await import('@sentry/nextjs');

    Sentry.init({
      dsn,
      sendDefaultPii: false,
      // Performance tracing stays disabled: error monitoring only, minimal data surface.
      tracesSampleRate: 0,
    });

    initialized = true;
  } catch {
    // Monitoring must never break the runtime it observes.
  }
}

/** Client initialization for src/instrumentation-client.ts. Same privacy posture. */
export async function initErrorMonitorClient(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

  if (!dsn || initialized) {
    return;
  }

  try {
    const Sentry = await import('@sentry/nextjs');

    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });

    initialized = true;
  } catch {
    // Swallow-all: client monitoring can never break the app it observes.
  }
}

async function getSentryCapture(): Promise<
  ((error: unknown, hint?: ExclusiveEventHintOrCaptureContext) => unknown) | null
> {
  if (!allowedDsn()) {
    return null;
  }

  try {
    const Sentry = await import('@sentry/nextjs');

    return Sentry.captureException.bind(Sentry);
  } catch {
    return null;
  }
}

/** Report an unexpected exception. Never throws; no sensitive context is attached. */
export async function reportError(error: unknown): Promise<void> {
  try {
    const capture = await getSentryCapture();

    if (!capture) {
      return;
    }

    capture(error);
  } catch {
    // Reporting failures are swallowed - the original error path stays authoritative.
  }
}

/**
 * Framework hook target for Next.js onRequestError (server/edge). Only unhandled
 * exceptions arrive here. The request URL is sanitized before transmission and ONLY
 * the safe subset of framework context (router path) is forwarded - never headers,
 * cookies, bodies, or query strings.
 */
export async function reportRequestError(
  request: MinimalRequest,
  error: unknown,
  context: MinimalErrorContext
): Promise<void> {
  try {
    const capture = await getSentryCapture();

    if (!capture) {
      return;
    }

    const sanitizedUrl = sanitizeErrorUrl(request?.url);
    const routerPath = typeof context?.routerPath === 'string' ? context.routerPath : undefined;

    capture(error, {
      tags: routerPath ? { router_path: routerPath } : {},
      contexts: {
        request: {
          url: sanitizedUrl ?? 'unknown',
          method: typeof request?.method === 'string' ? request.method : undefined,
        },
      },
    });
  } catch {
    // Swallow-all.
  }
}
