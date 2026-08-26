'use client';

import { useEffect, useRef, useState } from 'react';

import { getActiveCategoryOptions, type CategoryOption } from '@/lib/bids-client';
import { submitBid } from '@/lib/bid-submit';

/**
 * Centered full-screen bidding console.
 *
 * [ Your product url or @handle ] [ category icon â–¾ ] [ Bid ]
 *
 * - The single textbox is the bidder's PUBLIC entry identifier: a product URL (plain
 *   or bare domain), an arbitrary domain-like string, or an @handle. All forms are
 *   valid bid targets - NO external resolution, DNS lookup, or search is required.
 * - The two-column preview below the input is informational only:
 *     LEFT  = the accepted public-entry identifier ("Verified public entry." means the
 *             application accepted it as a valid identifier - nothing more).
 *     RIGHT = POSITION FORECAST derived deterministically from live database bids
 *             (same ordering/floor rules as the leaderboard and checkout RPC).
 * - The forecast never authorizes anything: POST /api/bids/checkout re-derives the
 *   authoritative amount server-side inside the create_pending_bid row lock, and the
 *   webhook remains the sole payment authority.
 */

const FORECAST_DEBOUNCE_MS = 400;

type Forecast = {
  nextAmountCents: number;
  projectedRank: number;
  totalPaidBids: number;
  currentTopCents: number | null;
};

type ForecastState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; forecast: Forecast };

function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default function BidConsole() {
  const [product, setProduct] = useState('');
  const [selected, setSelected] = useState<CategoryOption | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [options, setOptions] = useState<CategoryOption[] | null>(null);
  const [pending, setPending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [forecastState, setForecastState] = useState<ForecastState>({ kind: 'idle' });
  const menuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestKeyRef = useRef('');

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

  // Debounced position-forecast refresh (read-only feed; purely informational).
  useEffect(() => {
    const trimmed = product.trim();
    const key = selected ? `${selected.slug}|${trimmed}` : `${selected ?? ''}|${trimmed}`;

    if (!trimmed) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      if (latestKeyRef.current === key && forecastState.kind !== 'error') return;

      latestKeyRef.current = key;
      setForecastState({ kind: 'loading' });

      try {
        const url = new URL('/api/bids/forecast', window.location.origin);

        if (selected) {
          url.searchParams.set('category', selected.slug);
        }

        const response = await fetch(url.toString());
        const body = (await response.json()) as { forecast?: Forecast };

        if (latestKeyRef.current !== key) return;

        if (response.ok && body.forecast) {
          setForecastState({ kind: 'ready', forecast: body.forecast });
        } else {
          setForecastState({ kind: 'error' });
        }
      } catch {
        if (latestKeyRef.current === key) {
          setForecastState({ kind: 'error' });
        }
      }
    }, FORECAST_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, selected]);

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

    setErrorText(null);

    if (!product.trim()) {
      setErrorText('Enter your product url or @handle first.');
      return;
    }

    setPending(true);

    // The client submits ONLY identity (+ optional category). The authoritative
    // amount is derived server-side inside create_pending_bid's row lock.
    const outcome = await submitBid({
      product,
      categorySlug: selected?.slug ?? null,
    });

    if (outcome.ok) {
      window.location.assign(outcome.url);
      return;
    }

    setPending(false);
    setErrorText(
      outcome.error === 'invalid_product'
        ? 'Enter your product url or @handle.'
        : outcome.minimumBid != null
          ? `The minimum bid has moved to $${Math.ceil(outcome.minimumBid / 100)}. Please try again.`
          : 'Could not start checkout. Please try again.'
    );
  }

  // Empty input derives the idle preview during render - no effect-setState needed.
  const effectiveForecast: ForecastState = product.trim() === '' ? { kind: 'idle' } : forecastState;

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
                    {selected === null ? 'âœ“ Leading category' : 'Leading category (auto)'}
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
                      {selected?.slug === option.slug ? 'âœ“ ' : ''}
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
            disabled={pending}
            className="min-h-11 shrink-0 rounded-lg bg-primary px-8 text-lg font-semibold text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 motion-safe:active:scale-[0.98] motion-reduce:active:scale-100 sm:min-h-14 sm:px-10"
          >
            {pending ? 'Starting…' : 'Bid'}
          </button>
        </div>

        {errorText ? (
          <p
            id="bid-console-error"
            className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-center text-sm text-destructive sm:text-left"
            role="alert"
          >
            {errorText}
          </p>
        ) : null}

        {product.trim() ? (
          <div
            className="mt-4 grid w-full grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2"
            data-testid="entry-preview"
          >
            {/* LEFT â€” accepted public entry */}
            <div className="bg-background px-4 py-3">
              <div
                className="truncate text-sm font-semibold text-foreground"
                data-testid="preview-identifier"
              >
                {product.trim()}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">Verified public entry.</div>
            </div>

            {/* RIGHT â€” position forecast (informational, database-derived) */}
            <div className="bg-background px-4 py-3">
              <div className="text-xs font-bold uppercase tracking-wide text-primary">
                Position forecast
              </div>

              {effectiveForecast.kind === 'ready' ? (
                <>
                  <div className="mt-0.5 text-sm font-semibold text-foreground">
                    Projected #{effectiveForecast.forecast.projectedRank} of{' '}
                    {effectiveForecast.forecast.totalPaidBids} on the live board ·{' '}
                    {effectiveForecast.forecast.currentTopCents === null ||
                    effectiveForecast.forecast.nextAmountCents <=
                      effectiveForecast.forecast.currentTopCents
                      ? `New listing at ${formatUsd(effectiveForecast.forecast.nextAmountCents)}`
                      : `Raise of $1 from the current ${formatUsd(
                          effectiveForecast.forecast.currentTopCents
                        )}`}{' '}
                    · lifetime {formatUsd(effectiveForecast.forecast.nextAmountCents)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {effectiveForecast.forecast.projectedRank === 1
                      ? 'Top of the board'
                      : `#${effectiveForecast.forecast.projectedRank - 1} currently needs ${formatUsd(
                          effectiveForecast.forecast.nextAmountCents
                        )}`}
                  </div>
                </>
              ) : effectiveForecast.kind === 'loading' || effectiveForecast.kind === 'idle' ? (
                <div className="mt-0.5 text-sm text-muted-foreground">Checking the board…</div>
              ) : (
                <div className="mt-0.5 text-sm text-muted-foreground">
                  Live-board forecast unavailable right now â€” bidding still works.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
