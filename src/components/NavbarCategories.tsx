'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { getActiveCategoryOptions, type CategoryOption } from '@/lib/bids-client';
import { buildCategoryUrl } from '@/lib/share-url';

/**
 * Navbar "Categories" navigation (UI redesign follow-up).
 *
 * Previously a dead link to "/" (and the mobile menu carried a dead "/leaderboard"
 * target). This component makes category navigation REAL using only existing
 * architecture:
 * - options come from the RLS-safe active-categories query (bids-client)
 * - each entry navigates through the canonical URL helper buildCategoryUrl
 *   (NEXT_PUBLIC_APP_URL + percent-encoded /categories/<slug>) - no duplicate routing
 * - closes on selection, outside pointer press, and Escape; trigger is a real button
 *   with aria-expanded/aria-haspopup and 44px touch targets
 *
 * variant="desktop" renders an inline dropdown under the trigger;
 * variant="mobile" renders the option links full-width inside the mobile menu panel.
 */
export default function NavbarCategories({ variant }: { variant: 'desktop' | 'mobile' }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CategoryOption[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);

    if (options === null) {
      try {
        setOptions(await getActiveCategoryOptions());
      } catch {
        setOptions([]);
      }
    }
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');

  if (variant === 'mobile') {
    return (
      <div ref={rootRef} className="flex flex-col gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="mobile-categories-list"
          className="inline-flex min-h-11 w-full items-center justify-between rounded-md px-3 text-base font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Categories
          <svg
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open ? (
          <div id="mobile-categories-list" className="flex flex-col gap-1 pl-3">
            {(options ?? []).map((option) => (
              <Link
                key={option.slug}
                href={buildCategoryUrl(appUrl, option.slug)}
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {option.name}
              </Link>
            ))}
            {options !== null && options.length === 0 ? (
              <span className="px-3 py-2 text-sm text-muted-foreground">No categories yet.</span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 after:absolute after:bottom-0 after:left-2 after:right-2 after:h-px after:bg-foreground after:scale-x-0 after:transition-transform after:duration-200 hover:after:scale-x-100 motion-reduce:after:transition-none inline-flex min-h-11 items-center gap-1"
      >
        Categories
        <svg
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg">
          <ul role="menu" aria-label="Categories">
            {(options ?? []).map((option) => (
              <li key={option.slug} role="none">
                <Link
                  role="menuitem"
                  href={buildCategoryUrl(appUrl, option.slug)}
                  onClick={() => setOpen(false)}
                  className="inline-flex min-h-11 w-full items-center px-4 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:bg-muted"
                >
                  {option.name}
                </Link>
              </li>
            ))}
            {options !== null && options.length === 0 ? (
              <li role="none" className="px-4 py-3 text-sm text-muted-foreground">
                No categories yet.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
