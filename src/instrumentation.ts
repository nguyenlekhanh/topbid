/**
 * Next.js instrumentation hooks (Task 10.7 - error monitoring).
 *
 * Observational wiring only:
 * - register(): initializes the Sentry SDK (server/edge) when a DSN is configured;
 *   no-op otherwise so local builds/tests stay fully green without credentials
 * - onRequestError(): the framework-native capture point for UNHANDLED exceptions
 *   escaping any server route/render. Expected business outcomes (typed validation,
 *   authorization, payment-state, idempotency, rate-limit results) never reach this
 *   hook - they keep their existing typed/console handling untouched.
 *
 * All heavy lifting lives in src/lib/error-monitor.ts; nothing here can throw into the
 * runtime.
 */

import { initErrorMonitor, reportRequestError } from '@/lib/error-monitor';

export async function register(): Promise<void> {
  await initErrorMonitor();
}

export function onRequestError(
  request: { url?: unknown; method?: unknown },
  error: unknown,
  context: { routerPath?: unknown } & Record<string, unknown>
): void {
  void reportRequestError(request, error, context);
}
