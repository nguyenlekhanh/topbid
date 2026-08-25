'use client';

import { useState } from 'react';
import Link from 'next/link';

import NavbarCategories from '@/components/NavbarCategories';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center">
            <Link
              href="/"
              className="text-lg font-semibold text-foreground"
              aria-label="Topbid.lol home"
            >
              Topbid.lol
            </Link>
          </div>

          <div className="hidden md:flex md:items-center md:gap-6">
            <NavbarCategories variant="desktop" />
            <Link
              href="/#leaderboard-heading"
              className="relative text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md px-2 py-1 after:absolute after:bottom-0 after:left-2 after:right-2 after:h-px after:bg-foreground after:scale-x-0 after:transition-transform after:duration-200 hover:after:scale-x-100 motion-reduce:after:transition-none"
            >
              Leaderboard
            </Link>
          </div>

          <div className="flex md:hidden">
            <button
              type="button"
              className="inline-flex items-center justify-center p-2.5 min-h-11 min-w-11 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div
            id="mobile-menu"
            className="md:hidden py-4 border-t border-border motion-safe:animate-[slideDown_200ms_ease-out] motion-reduce:animate-none"
          >
            <div className="flex flex-col gap-2">
              <NavbarCategories variant="mobile" />
              <Link
                href="/#leaderboard-heading"
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-base font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground hover:translate-x-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transform-none"
              >
                Leaderboard
              </Link>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
