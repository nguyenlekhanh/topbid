'use client';

import { useEffect, useRef, useState } from 'react';

import { getActiveCategoryOptions, type CategoryOption } from '@/lib/bids-client';
import { submitBid } from '@/lib/bid-submit';
import ProductPreviewCard, { type PreviewState } from '@/components/ProductPreviewCard';

/**
 * Centered full-screen bidding console (UI redesign task).
 *
 * [ Your product url or @handle ] [ category icon ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â¾ ] [ Bid ]
 *
 * - No manual amount input exists ANYWHERE in this flow: clicking Bid asks the server
 *   (POST /api/bids/checkout) to derive the authoritative amount and return the Stripe
 *   Checkout URL, then navigates. The server/database remain the only amount authority.
 * - The single textbox is the bidder's PUBLIC product identifier (https URL or
 *   @handle). URLs are resolved into a metadata PREVIEW (title/description/image) via
 *   POST /api/products/resolve before checkout; @handles return a typed unsupported
 *   result (no platform is established yet) and keep Bid disabled.
 * - The category icon opens a VERTICAL dropdown of ACTIVE categories (authoritative,
 *   RLS-filtered); selecting one targets that category, leaving it unselected targets
 *   the global leading category per server rules. Outside click / Escape / selection
 *   all close the menu.
 */

const RESOLVE_DEBOUNCE_MS = 600;

type ApiPreview = {
  sourceUrl?: unknown;
  canonicalUrl?: unknown;
  title?: unknown;
  description?: unknown;
  imageUrl?: unknown;
  faviconUrl?: unknown;
  siteName?: unknown;
};

function toPreview(raw: ApiPreview): {
  sourceUrl: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  siteName: string | null;
} {
  return {
    sourceUrl: String(raw.sourceUrl),
    canonicalUrl: String(raw.canonicalUrl),
    title: typeof raw.title === 'string' ? raw.title : null,
    description: typeof raw.description === 'string' ? raw.description : null,
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : null,
    faviconUrl: typeof raw.faviconUrl === 'string' ? raw.faviconUrl : null,
    siteName: typeof raw.siteName === 'string' ? raw.siteName : null,
  };
}

export default function BidConsole() {
  const [product, setProduct] = useState('');
  const [selected, setSelected] = useState<CategoryOption | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [options, setOptions] = useState<CategoryOption[] | null>(null);
  const [pending, setPending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>({ kind: 'idle' });
  const menuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestInputRef = useRef('');

  // Debounced preview resolution against the typed URL (explicit contract: the server
  // validates and normalizes; the client renders only whitelisted metadata fields).
  useEffect(() => {
    const input = product.trim();

    if (!input) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // All setState calls happen inside this deferred callback (never synchronously in
    // the effect body), satisfying the React hooks lint rule.
    debounceRef.current = setTimeout(async () => {
      setPreviewState({ kind: 'loading' });

      latestInputRef.current = input;

      try {
        const response = await fetch('/api/products/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input }),
        });

        // A newer input took over while this request was in flight - discard it.
        if (latestInputRef.current !== input) return;

        const body = (await response.json()) as {
          preview?: Record<string, unknown>;
          error?: string;
        };

        if (response.ok && body.preview && typeof body.preview === 'object') {
          setPreviewState({
            kind: 'resolved',
            preview: toPreview(body.preview as ApiPreview),
          });
        } else if (body.error === 'unsupported_handle') {
          setPreviewState({ kind: 'unsupported_handle' });
        } else if (body.error === 'invalid_product' || body.error === 'invalid_input') {
          setPreviewState({ kind: 'error', message: 'invalid_input' });
        } else if (body.error === 'unsafe_url') {
          setPreviewState({ kind: 'error', message: 'unsafe_url' });
        } else {
          setPreviewState({ kind: 'error', message: body.error ?? 'fetch_failed' });
        }
      } catch {
        if (latestInputRef.current === input) {
          setPreviewState({ kind: 'error', message: 'fetch_failed' });
        }
      }
    }, RESOLVE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [product]);

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  async function toggleMenu() {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }

    setMenuOpen(true);

    if (options === null) {
      try {
        setOptions(await getActiveCategoryOptions());
      } catch {
        setOptions([]);
      }
    }
  }

  async function onBidClick() {
    if (pending) return;

    // Ensure the CURRENT input is resolved before checkout: the preview's canonical
    // URL becomes the submitted product identifier.
    let currentState = previewState;
    const trimmed = product.trim();

    if (!trimmed) {
      setErrorText('Enter your product url or @handle first.');
      return;
    }

    if (currentState.kind !== 'resolved') {
      setPreviewState({ kind: 'loading' });
      try {
        const response = await fetch('/api/products/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: trimmed }),
        });
        const body = (await response.json()) as {
          preview?: Record<string, unknown>;
          error?: string;
        };

        if (!response.ok || !body.preview) {
          setPreviewState({
            kind: 'error',
            message: typeof body.error === 'string' ? body.error : 'fetch_failed',
          });
          return;
        }

        const p = body.preview as ApiPreview;
        currentState = {
          kind: 'resolved',
          preview: toPreview(p),
        };
        setPreviewState(currentState);
      } catch {
        setErrorText('Could not resolve that product URL.');
        return;
      }
    }

    // After the ensure-block, the state is either resolved or still loading; only
    // a resolved preview may proceed to checkout.
    const resolvedPreview = currentState.kind === 'resolved' ? currentState.preview : null;

    if (!resolvedPreview) {
      setErrorText('Resolving is still in progress - try again in a moment.');
      return;
    }

    setPending(true);

    const outcome = await submitBid({
      product: resolvedPreview.canonicalUrl || resolvedPreview.sourceUrl,
      categorySlug: selected?.slug ?? null,
    });

    if (outcome.ok) {
      window.location.assign(outcome.url);
      return;
    }

    setPending(false);
    setErrorText(
      outcome.error === 'banned_email'
        ? 'This entry is not allowed to bid.'
        : outcome.minimumBid != null
          ? `The minimum bid is now $${Math.ceil(outcome.minimumBid / 100)}. Please try again.`
          : 'Could not start checkout. Please try again.'
    );
  }

  const effectivePreview: PreviewState = product.trim() === '' ? { kind: 'idle' } : previewState;

  // Bid unlocks ONLY when the current input has successfully resolved: the
  // preview's canonical URL is what gets submitted to checkout.
  const bidDisabled = pending || effectivePreview.kind !== 'resolved';

  return (
    <section
      className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-16"
      aria-labelledby="bid-console-heading"
    >
      <h1 id="bid-console-heading" className="sr-only">
        Place your bid
      </h1>

      <div className="w-full max-w-2xl">
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <label htmlFor="bid-console-product" className="sr-only">
            Your product url or @handle
          </label>
          <input
            id="bid-console-product"
            name="product"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="Your product url or @handle"
            value={product}
            onChange={(event) => setProduct(event.target.value)}
            disabled={pending}
            aria-describedby={errorText ? 'bid-console-error' : undefined}
            className="min-h-11 w-full flex-1 rounded-lg border border-border bg-background px-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />

          <div className="relative sm:shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={toggleMenu}
              aria-expanded={menuOpen}
              aria-haspopup="listbox"
              aria-label={selected ? `Category: ${selected.name}` : 'Choose a category'}
              className="inline-flex min-h-11 min-w-11 w-full items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </button>

            {menuOpen ? (
              <ul
                role="listbox"
                aria-label="Categories"
                className="absolute right-0 z-30 mt-2 max-h-72 w-full min-w-[12rem] overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg focus-visible:outline-none sm:left-0 sm:right-auto sm:w-64"
              >
                <li role="option" aria-selected={selected === null}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setMenuOpen(false);
                    }}
                    className="inline-flex min-h-11 w-full items-center px-4 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:bg-muted"
                  >
                    {selected === null
                      ? 'ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Leading category'
                      : 'Leading category (auto)'}
                  </button>
                </li>
                {(options ?? []).map((option) => (
                  <li
                    key={option.slug}
                    role="option"
                    aria-selected={selected?.slug === option.slug}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(option);
                        setMenuOpen(false);
                      }}
                      className="inline-flex min-h-11 w-full items-center px-4 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:bg-muted"
                    >
                      {selected?.slug === option.slug ? 'ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ ' : ''}
                      {option.name}
                    </button>
                  </li>
                ))}
                {options !== null && options.length === 0 ? (
                  <li role="presentation" className="px-4 py-3 text-sm text-muted-foreground">
                    No active categories yet.
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onBidClick}
            disabled={bidDisabled}
            className="min-h-11 shrink-0 rounded-lg bg-primary px-8 text-lg font-semibold text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 motion-safe:active:scale-[0.98] motion-reduce:active:scale-100 sm:min-h-14 sm:px-10"
          >
            {pending ? 'Starting…' : 'Bid'}
          </button>
        </div>

        <div className="mt-3">
          <ProductPreviewCard state={effectivePreview} />
        </div>

        {errorText ? (
          <p
            id="bid-console-error"
            className="mt-2 text-center text-xs text-destructive sm:text-left"
            role="alert"
          >
            {errorText}
          </p>
        ) : (
          <p className="mt-2 text-center text-xs text-muted-foreground sm:text-left">
            {selected ? `Bidding on: ${selected.name}.` : ''} The next required amount is calculated
            automatically from the current highest bid.
          </p>
        )}
      </div>
    </section>
  );
}
