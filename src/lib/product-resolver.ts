import { lookup } from 'node:dns/promises';

import { normalizeProductInput } from './product-input';

/**
 * Server-side product metadata resolver (UI redesign follow-up).
 *
 * Resolves a user-supplied product URL into normalized preview metadata. This module
 * is the SSRF trust boundary for outbound fetching and follows fail-closed semantics:
 * every hop (including redirects) is re-validated against the same rules.
 *
 * @handle inputs are deliberately NOT resolved to any social platform: the repository
 * establishes no provider for them. They return a typed unsupported_handle result so
 * the product decision can be made explicitly later (provider isolated behind this
 * boundary).
 *
 * Nothing here touches Stripe, the database, or service-role credentials, and nothing
 * is persisted - preview only.
 */

export const MAX_REDIRECTS = 3;
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const FETCH_TIMEOUT_MS = 8_000;

export type ProductPreview = {
  sourceUrl: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  siteName: string | null;
};

export type ProductFailureReason =
  | 'invalid_input'
  | 'unsupported_handle'
  | 'unsafe_url'
  | 'timeout'
  | 'response_too_large'
  | 'not_html'
  | 'not_found'
  | 'fetch_failed';

export type ProductResolution =
  { ok: true; preview: ProductPreview } | { ok: false; reason: ProductFailureReason };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type LookupLike = typeof lookup;

// --- SSRF guards ---------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.goog',
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function isPrivateIPv4(ip: string): boolean {
  const v = ipv4ToInt(ip);
  if (v === null) return true;

  const inRange = (base: number, maskBits: number) =>
    v >>> (32 - maskBits) === base >>> (32 - maskBits);

  return (
    inRange(ipv4ToInt('0.0.0.0')!, 8) ||
    inRange(ipv4ToInt('10.0.0.0')!, 8) ||
    inRange(ipv4ToInt('127.0.0.0')!, 8) ||
    inRange(ipv4ToInt('169.254.0.0')!, 16) ||
    inRange(ipv4ToInt('172.16.0.0')!, 12) ||
    inRange(ipv4ToInt('192.168.0.0')!, 16) ||
    inRange(ipv4ToInt('100.64.0.0')!, 10) ||
    inRange(ipv4ToInt('198.18.0.0')!, 15)
  );
}

function expandIPv6(ip: string): bigint | null {
  const head = ip.split('%')[0]; // strip zone id

  const doubleColonParts = head.split('::');
  if (doubleColonParts.length > 2) return null;

  let groups: string[];
  if (doubleColonParts.length === 2) {
    const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
    const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill('0'), ...right];
  } else {
    groups = head.split(':');
  }

  if (groups.length !== 8) return null;

  let value = BigInt(0);
  const groupSize = BigInt(65536);

  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = value * groupSize + BigInt(parseInt(group, 16));
  }
  return value;
}

function isPrivateIPv6(ip: string): boolean {
  const lowered = ip.toLowerCase();

  // IPv4-mapped (::ffff:a.b.c.d) - validate the embedded v4 address instead.
  const mapped = lowered.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isPrivateIPv4(mapped[1]);
  }
  const mappedHex = lowered.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const v = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    return isPrivateIPv4(v);
  }

  const v = expandIPv6(lowered);
  if (v === null) return true;

  const inPrefix = (prefix: string, bits: number) => {
    const p = expandIPv6(prefix);
    if (p === null) return false;
    const shiftBits = BigInt(128 - bits);
    return v >> shiftBits === p >> shiftBits;
  };

  return (
    inPrefix('::1', 128) ||
    inPrefix('fc00::', 7) || // unique local
    inPrefix('fe80::', 10) || // link-local
    inPrefix('2001:db8::', 32) || // documentation
    inPrefix('::ffff:0:0', 96) // v4-mapped range generally
  );
}

export function isPrivateAddress(address: string): boolean {
  if (address.includes('.') && !address.includes(':')) {
    return isPrivateIPv4(address);
  }
  return isPrivateIPv6(address);
}

/**
 * Validates that a URL string is an http(s) URL pointing at a PUBLIC host.
 * Returns the normalized URL string, or null when unsafe/malformed.
 * DNS is resolved via the injectable lookup so rebinding/redirect targets are checked
 * against the actual addresses the fetcher will contact.
 */
export async function assertSafePublicUrl(
  raw: unknown,
  lookupImpl: LookupLike = lookup
): Promise<string | null> {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let parsed: URL;

  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if (!host) return null;
  if (BLOCKED_HOSTNAMES.has(host)) return null;
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return null;
  }

  // Literal IPs are checked directly; hostnames go through DNS resolution below
  // (a dotted HOSTNAME like example.com is not an IPv4 literal).
  const looksLikeIPv4Literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

  if (looksLikeIPv4Literal || host.includes(':')) {
    if (isPrivateAddress(host)) return null;
  } else {
    // Resolve ALL addresses for the hostname and require every one to be public
    // (mitigates DNS rebinding between check and fetch as far as check-time allows).
    try {
      const records = await lookupImpl(host, { all: true });
      if (!records.length) return null;
      for (const record of records) {
        if (isPrivateAddress(record.address)) return null;
      }
    } catch {
      return null;
    }
  }

  return parsed.toString();
}

// --- Bounded fetch ---------------------------------------------------------------

async function fetchBounded(
  url: string,
  fetchImpl: FetchLike,
  depth: number,
  lookupImpl: LookupLike
): Promise<
  | { ok: true; finalUrl: string; contentType: string; html: string }
  | { ok: false; reason: ProductFailureReason }
> {
  const safe = await assertSafePublicUrl(url, lookupImpl);

  if (!safe) {
    return { ok: false, reason: 'unsafe_url' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(safe, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    // Redirects are followed MANUALLY so every destination is re-validated.
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');

      if (!location) {
        return { ok: false, reason: 'fetch_failed' };
      }
      if (depth >= MAX_REDIRECTS) {
        return { ok: false, reason: 'unsafe_url' };
      }

      const next = new URL(location, safe).toString();

      return fetchBounded(next, fetchImpl, depth + 1, lookupImpl);
    }

    if (response.status === 404 || response.status === 410) {
      return { ok: false, reason: 'not_found' };
    }

    if (!response.ok) {
      return { ok: false, reason: 'fetch_failed' };
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();

    if (contentType && !contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { ok: false, reason: 'not_html' };
    }

    if (response.body === null) {
      return { ok: false, reason: 'fetch_failed' };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let html = '';
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      received += value.byteLength;

      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return { ok: false, reason: 'response_too_large' };
      }

      html += decoder.decode(value, { stream: true });
    }

    return { ok: true, finalUrl: safe, contentType, html };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}

// --- Metadata extraction (pure) --------------------------------------------------

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim()
    .slice(0, 500);
}

function firstTagAttribute(
  tags: string[],
  attributeName: string,
  valueFilter?: (attributeValue: string) => boolean
): string | null {
  for (const tag of tags) {
    const attributeValue = tag.match(new RegExp(`${attributeName}=["']([^"']+)["']`, 'i'))?.[1];

    if (attributeValue && (!valueFilter || valueFilter(attributeValue))) {
      return decodeEntities(attributeValue);
    }
  }

  return null;
}

export function extractProductMetadata(
  html: string,
  pageUrl: string
): {
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  siteName: string | null;
} {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];

  const byKey = (key: string): string | null => {
    const lower = key.toLowerCase();

    for (const tag of metaTags) {
      const property = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1]?.toLowerCase();

      if (property === lower) {
        const content = tag.match(/content=["']([^"']*)["']/i)?.[1];

        if (content && content.trim()) {
          return decodeEntities(content);
        }
      }
    }

    return null;
  };

  const absolute = (value: string | null): string | null => {
    if (!value) return null;

    try {
      return new URL(value, pageUrl).toString();
    } catch {
      return null;
    }
  };

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const descriptionMeta = byKey('description');

  const canonicalLinkHref = firstTagAttribute(
    linkTags.filter((tag) => /\brel=["']canonical["']/i.test(tag)),
    'href'
  );
  const canonical = absolute(canonicalLinkHref) ?? pageUrl;
  const ogImage = absolute(byKey('og:image'));
  const twitterImage = absolute(byKey('twitter:image'));
  const iconLink =
    firstTagAttribute(
      linkTags.filter((tag) => /\brel=["'][^"']*icon/i.test(tag)),
      'href'
    ) ?? null;

  return {
    canonicalUrl: canonical,
    title: byKey('og:title') ?? (titleTag ? decodeEntities(titleTag) : null),
    description:
      byKey('og:description') ?? (descriptionMeta ? decodeEntities(descriptionMeta) : null),
    imageUrl: ogImage ?? twitterImage,
    faviconUrl: absolute(iconLink) ?? `${new URL(pageUrl).origin}/favicon.ico`,
    siteName: byKey('og:site_name') ?? new URL(canonical).hostname.replace(/^www\./, ''),
  };
}

// --- Orchestrator -----------------------------------------------------------------

export async function resolveProductPreview(
  input: unknown,
  options: { fetchImpl?: FetchLike; lookupImpl?: LookupLike } = {}
): Promise<ProductResolution> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupImpl = options.lookupImpl ?? lookup;

  if (typeof input !== 'string') {
    return { ok: false, reason: 'invalid_input' };
  }

  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, reason: 'invalid_input' };
  }

  if (trimmed.startsWith('@')) {
    // No provider is established for @handles in this repository. Typed boundary:
    // the product decision (X/Twitter/ProductHunt/etc.) must be made explicitly.
    return { ok: false, reason: 'unsupported_handle' };
  }

  // Bare domains (walmart.com) are granted https:// by the shared normalizer; the
  // normalized value then passes the SAME SSRF validation as explicit URLs.
  const normalizedInput = normalizeProductInput(trimmed);

  if (!normalizedInput.ok || normalizedInput.kind !== 'url') {
    return { ok: false, reason: 'invalid_input' };
  }

  const fetched = await fetchBounded(normalizedInput.value, fetchImpl, 0, lookupImpl);

  if (!fetched.ok) {
    return { ok: false, reason: fetched.reason };
  }

  const metadata = extractProductMetadata(fetched.html, fetched.finalUrl);

  return {
    ok: true,
    preview: {
      sourceUrl: fetched.finalUrl,
      canonicalUrl: metadata.canonicalUrl,
      title: metadata.title,
      description: metadata.description,
      imageUrl: metadata.imageUrl,
      faviconUrl: metadata.faviconUrl,
      siteName: metadata.siteName,
    },
  };
}
