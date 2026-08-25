'use client';

import { useEffect, useRef, useState } from 'react';

import { getActiveCategoryOptions, type CategoryOption } from '@/lib/bids-client';
import { submitBid } from '@/lib/bid-submit';

/**
 * Centered full-screen bidding console (UI redesign task).
 *
 * [ Your product url or @handle ] [ category icon ▾ ] [ Bid ]
 *
 * - No manual amount input exists ANYWHERE in this flow: clicking Bid asks the server
 *   (POST /api/bids/checkout) to derive the authoritative amount and return the Stripe
 *   Checkout URL, then navigates. The server/database remain the only amount authority.
 * - The single textbox is the bidder's PUBLIC product identifier (https URL or
 *   @handle) - never an email address.
 * - The category icon opens a VERTICAL dropdown of ACTIVE categories (authoritative,
 *   RLS-filtered); selecting one targets that category, leaving it unselected targets
 *   the global leading category per server rules. Outside click / Escape / selection
 *   all close the menu.
 */
export default function BidConsole() {
  const [product, setProduct] = useState('');
  const [selected, setSelected] = useState<CategoryOption | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [options, setOptions] = useState<CategoryOption[] | null>(null);
  const [pending, setPending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

    setErrorText(null);
    setPending(true);

    const outcome = await submitBid({ product, categorySlug: selected?.slug ?? null });

    if (outcome.ok) {
      window.location.assign(outcome.url);
      return;
    }

    setPending(false);
    setErrorText(
      outcome.error === 'invalid_product'
        ? 'Enter a valid product URL (https://…) or @handle.'
        : outcome.minimumBid != null
          ? `The minimum bid is now $${Math.ceil(outcome.minimumBid / 100)}. Please try again.`
          : 'Could not start checkout. Please try again.'
    );
  }

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
                    {selected === null ? '✓ Leading category' : 'Leading category (auto)'}
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
                      {selected?.slug === option.slug ? '✓ ' : ''}
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

        <p
          className="mt-3 text-center text-xs text-muted-foreground sm:text-left"
          aria-live="polite"
        >
          {selected ? `Bidding on: ${selected.name}. ` : ''}
          {errorText ??
            'The next required amount is calculated automatically from the current highest bid.'}
        </p>
      </div>
    </section>
  );
}
