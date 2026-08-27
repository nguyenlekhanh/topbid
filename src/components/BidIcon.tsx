'use client';

/**
 * BidIcon - Displays an icon for a bid entry based on its metadata.
 *
 * Priority:
 * 1. entry_favicon_url - if available, display as favicon
 * 2. entry_image_url - if available, display as image
 * 3. entry_type === 'handle' - display X/Twitter handle icon
 * 4. entry_type === 'url' - display globe icon
 * 5. fallback - generic document/link icon
 */
export default function BidIcon({
  entryFaviconUrl,
  entryImageUrl,
  entryType,
  size = 24,
}: {
  entryFaviconUrl: string | null;
  entryImageUrl: string | null;
  entryType: 'url' | 'handle' | 'unknown' | null;
  size?: number;
}) {
  const iconSize = `${size}px`;

  if (entryFaviconUrl) {
    return (
      <img
        src={entryFaviconUrl}
        alt=""
        className="rounded"
        style={{ width: iconSize, height: iconSize }}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
        aria-hidden="true"
      />
    );
  }

  if (entryImageUrl) {
    return (
      <img
        src={entryImageUrl}
        alt=""
        className="rounded"
        style={{ width: iconSize, height: iconSize }}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
        aria-hidden="true"
      />
    );
  }

  if (entryType === 'handle') {
    return (
      <svg
        className="text-muted-foreground"
        style={{ width: iconSize, height: iconSize }}
        fill="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }

  if (entryType === 'url') {
    return (
      <svg
        className="text-muted-foreground"
        style={{ width: iconSize, height: iconSize }}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
        />
      </svg>
    );
  }

  return (
    <svg
      className="text-muted-foreground"
      style={{ width: iconSize, height: iconSize }}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
      />
    </svg>
  );
}
