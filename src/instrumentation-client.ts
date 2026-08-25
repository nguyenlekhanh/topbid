/**
 * Client-side error monitoring initialization (Task 10.7).
 *
 * Loaded by Next.js in the browser before hydration. Uses ONLY the public DSN
 * variable (NEXT_PUBLIC_SENTRY_DSN); no build-only or server-only credential is ever
 * referenced from client code. No-op when unconfigured.
 */

import { initErrorMonitorClient } from '@/lib/error-monitor';

void initErrorMonitorClient();
