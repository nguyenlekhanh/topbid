'use client';

/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react';
import BidButton from '@/components/BidButton';
import SuccessState from '@/components/SuccessState';

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  startingBid: number;
  increment: number;
  currentHighestBid?: number;
  bidCount: number;
}

interface BidModalProps {
  category: Category | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function getMinimumBid(category: Category): number {
  if (category.currentHighestBid != null) {
    return category.currentHighestBid + category.increment;
  }
  return category.startingBid;
}

export default function BidModal({ category, isOpen, onClose }: BidModalProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && emailInputRef.current) {
      emailInputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setEmail('');
      setName('');
      setIsSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen || !category) return null;

  const minimumBid = getMinimumBid(category);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bid-modal-title"
    >
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-background shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background px-4 sm:px-6 py-4">
          <h2 id="bid-modal-title" className="text-lg font-semibold text-foreground">
            {isSuccess ? 'Success! (demo)' : `Bid on ${category.name}`}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Close modal"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="px-4 sm:px-6 py-6 space-y-6">
          {isSuccess ? (
            <SuccessState
              amount={formatCurrency(minimumBid)}
              category={category.name}
              reference={`BID-MOCK-${category.id.padStart(4, '0')}`}
              onClose={onClose}
              onViewLeaderboard={onClose}
            />
          ) : (
            <>
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Current highest bid</div>
                    <div className="mt-1 font-semibold text-foreground">
                      {category.currentHighestBid != null
                        ? formatCurrency(category.currentHighestBid)
                        : 'No bids yet'}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Your minimum bid</div>
                    <div className="mt-1 font-bold text-primary text-lg">
                      {formatCurrency(minimumBid)}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Starting: {formatCurrency(category.startingBid)} • Increment:{' '}
                  {formatCurrency(category.increment)}
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="bid-email" className="block text-sm font-medium text-foreground">
                    Email <span className="text-destructive">*</span>
                  </label>
                  <input
                    ref={emailInputRef}
                    id="bid-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    required
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Outbid notifications will be sent here.
                  </p>
                </div>

                <div>
                  <label htmlFor="bid-name" className="block text-sm font-medium text-foreground">
                    Display name{' '}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <input
                    id="bid-name"
                    type="text"
                    autoComplete="name"
                    placeholder="How you appear on the leaderboard"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>

                <div>
                  <label htmlFor="bid-amount" className="block text-sm font-medium text-foreground">
                    Bid amount
                  </label>
                  <div className="mt-1.5 relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <input
                      id="bid-amount"
                      type="text"
                      value={(minimumBid / 100).toString()}
                      readOnly
                      aria-readonly="true"
                      className="w-full rounded-lg border border-border bg-muted px-8 py-2.5 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Calculated as highest bid + increment. You cannot change this value (UI
                    preview).
                  </p>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <BidButton
                  variant="outline"
                  size="md"
                  onClick={onClose}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </BidButton>
                <BidButton
                  variant="primary"
                  size="md"
                  onClick={() => setIsSuccess(true)}
                  className="w-full sm:w-auto"
                >
                  Continue to mock payment
                </BidButton>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                No real payment will be processed. This is a UI-only preview.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
