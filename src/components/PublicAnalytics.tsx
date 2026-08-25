'use client';

import { Analytics } from '@vercel/analytics/react';
import { usePathname } from 'next/navigation';

import { isPublicAnalyticsPath } from '@/lib/analytics-gate';

/**
 * Vercel Web Analytics mount, restricted to public pages (Task 10.6).
 *
 * - The provider script is injected ONLY on public/indexable routes; admin,
 *   authentication, payment-result, checkout-cancel, unsubscribe, and API surfaces
 *   render null and are never tracked
 * - Pageview-only: no custom events are sent (share/copy actions already have
   first-party share_events telemetry from Task 7.7, which stays untouched)
 * - Cookieless and non-blocking by provider design; an analytics outage can never
 *   affect rendering or any authoritative application flow
 */
export default function PublicAnalytics() {
  const pathname = usePathname();

  if (!isPublicAnalyticsPath(pathname)) {
    return null;
  }

  return <Analytics />;
}
