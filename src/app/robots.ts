import type { MetadataRoute } from 'next';

/**
 * robots.txt via Next.js App Router metadata routes (Task 10.5).
 *
 * Policy:
 * - All user agents may crawl the public site; explicit allow for '/'.
 * - Disallowed prefixes cover every non-SEO/private surface:
 *     /admin      - authentication + all management dashboards
 *     /api        - machine endpoints (webhooks, unsubscribe POST, telemetry)
 *     /success    - payment result; URL carries a Checkout Session identifier
 *     /cancel     - checkout plumbing, zero content value
 *     /unsubscribe - capability-token landing page; indexing could expose tokens
 * - The sitemap location is advertised as an absolute URL derived from the trusted
 *   NEXT_PUBLIC_APP_URL (the same single origin source every other builder uses).
 *
 * When NEXT_PUBLIC_APP_URL is not configured (e.g. some local builds), the rules are
 * still emitted and only the absolute sitemap reference is omitted - the file never
 * throws, mirroring how other APP_URL consumers fail soft on display-only paths.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api', '/success', '/cancel', '/unsubscribe'],
      },
    ],
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
