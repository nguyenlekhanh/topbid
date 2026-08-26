'use client';

import type { ProductPreview } from '@/lib/product-resolver';

export type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'unsupported_handle' }
  | { kind: 'resolved'; preview: ProductPreview };

const FAILURE_MESSAGES: Record<string, string> = {
  unsafe_url: 'That URL points to a private or unsafe address.',
  timeout: 'The site took too long to respond. Try again in a moment.',
  response_too_large: 'That page is too large to preview.',
  not_html: 'That link is not a web page, so it cannot be previewed.',
  not_found: 'That page does not exist (404).',
  fetch_failed: 'Could not reach that site. Check the URL and try again.',
  invalid_input: 'Enter a valid product URL or @handle.',
};

/**
 * Presentational card for the resolved product preview (UI redesign follow-up).
 * Pure/stateless so every state is deterministically renderable in tests.
 * Renders ONLY whitelisted metadata fields - never raw HTML, headers, or internals.
 */
export default function ProductPreviewCard({ state }: { state: PreviewState }) {
  if (state.kind === 'idle') return null;

  if (state.kind === 'loading') {
    return (
      <div
        className="w-full rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        Resolving product…
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        className="w-full rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        role="alert"
        aria-live="polite"
      >
        {FAILURE_MESSAGES[state.message] ?? 'Could not resolve that URL.'}
      </div>
    );
  }

  if (state.kind === 'unsupported_handle') {
    return (
      <div
        className="w-full rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-foreground"
        role="status"
      >
        This handle format isn&apos;t supported yet. Enter a product URL instead.
      </div>
    );
  }

  const { preview } = state;
  const displayTitle = preview.title ?? preview.siteName ?? preview.canonicalUrl;

  return (
    <div className="flex w-full items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-left">
      {preview.faviconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.faviconUrl}
          alt=""
          width={32}
          height={32}
          className="mt-0.5 h-8 w-8 shrink-0 rounded-md bg-background object-contain"
          onError={undefined}
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{displayTitle}</div>
        {preview.description ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{preview.description}</p>
        ) : null}
        <a
          href={preview.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-1 inline-block max-w-full truncate text-xs text-primary hover:underline"
        >
          {preview.sourceUrl}
        </a>
      </div>

      {preview.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.imageUrl}
          alt=""
          className="h-14 w-20 shrink-0 rounded-md object-cover"
          onError={undefined}
        />
      ) : null}
    </div>
  );
}
