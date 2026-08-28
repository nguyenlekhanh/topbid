'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { getActiveCategoryOptions, type CategoryOption } from '@/lib/bids-client';

/**
 * Navbar "Categories" navigation with homepage filtering.
 *
 * This component provides the top-right Category menu that controls
 * the homepage Top Bids filtering.
 *
 * - options come from the RLS-safe active-categories query (bids-client)
 * - "ALL" is added as the first option for showing all categories
 * - clicking a category navigates to /?category=<slug> for filtering
 * - "ALL" navigates to / (no filter)
 * - uses window.location.href for full page navigation/reload
 * - shows the currently selected category based on URL
 */
export default function NavbarCategories({ variant }: { variant: 'desktop' | 'mobile' }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CategoryOption[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();

  // Get the current category from URL query params
  const currentCategory = searchParams.get('category');
  const selectedCategory = currentCategory ?? 'all';

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

  function handleCategorySelect(slug: string) {
    if (slug === 'all') {
      // eslint-disable-next-line react-hooks/immutability, @next/next/no-location-assign-relative-destination
      window.location.href = '/';
    } else {
      // eslint-disable-next-line react-hooks/immutability, @next/next/no-location-assign-relative-destination
      window.location.href = `/?category=${encodeURIComponent(slug)}`;
    }
  }

  // Build options with ALL as first option
  const allOptions = [{ slug: 'all', name: 'ALL' }, ...(options ?? [])];

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
            {allOptions.map((option) => (
              <button
                key={option.slug}
                type="button"
                onClick={() => {
                  handleCategorySelect(option.slug);
                }}
                className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  selectedCategory === option.slug
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                }`}
              >
                {selectedCategory === option.slug ? '✓ ' : ''}
                {option.name}
              </button>
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
            {allOptions.map((option) => (
              <li key={option.slug} role="none">
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    handleCategorySelect(option.slug);
                  }}
                  className={`inline-flex min-h-11 w-full items-center px-4 text-sm ${
                    selectedCategory === option.slug
                      ? 'text-foreground font-medium bg-muted'
                      : 'text-foreground hover:bg-muted'
                  } focus-visible:outline-none focus-visible:bg-muted`}
                >
                  {selectedCategory === option.slug ? '✓ ' : ''}
                  {option.name}
                </button>
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
