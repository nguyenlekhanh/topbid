/**
 * Analytics route gate (Task 10.6).
 *
 * Pure decision for which paths may emit Vercel Web Analytics pageviews: everything
 * EXCEPT the private/non-SEO surfaces already excluded from search engines in Task
 * 10.5 - payment results (/success echoes a session id), checkout plumbing (/cancel),
 * the capability-token unsubscribe page, all admin/authentication screens, and machine
 * API endpoints.
 *
 * Matching is segment-exact (path equals the prefix or starts with "prefix/"), so a
 * hypothetical future public route like /administrator can never be swallowed by the
 * /admin exclusion. The declared robots.txt prefixes (Task 10.5) are intentionally
 * broader per crawler convention; both policies exclude every actual private surface.
 *
 * The result is presentation-only: analytics state is never read by bidding, payment,
 * webhook, notification, authorization, fraud, or any other authoritative flow.
 */
const PRIVATE_PREFIXES = ['/admin', '/api', '/success', '/cancel', '/unsubscribe'];

export function isPublicAnalyticsPath(pathname: unknown): boolean {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) {
    return false;
  }

  return !PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
