'use client';

import { useEffect, useState } from 'react';

import { getHighestPaidBidAmountForCategory } from '@/lib/bids-client';
import { createHighestBidTracker } from '@/lib/highest-bid-tracker';
import { subscribeToBidChanges } from '@/lib/realtime';

interface HighestBidDisplayProps {
  categoryId: string;
  initialAmount?: number | null;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Live "Current Bid" value for a category (Task 5.2).
 * Initialized with the server-provided amount, then kept in sync via the Task 5.1
 * realtime subscription; every realtime signal triggers an authoritative re-fetch so
 * displayed values always come from RLS-filtered database state.
 */
export default function HighestBidDisplay({ categoryId, initialAmount }: HighestBidDisplayProps) {
  const [amount, setAmount] = useState<number | null>(initialAmount ?? null);

  useEffect(() => {
    return createHighestBidTracker({
      categoryId,
      initialAmount: initialAmount ?? null,
      subscribe: subscribeToBidChanges,
      fetchHighest: getHighestPaidBidAmountForCategory,
      onHighestChange: setAmount,
    });
  }, [categoryId, initialAmount]);

  const shown = amount ?? initialAmount ?? null;

  return (
    <div className="font-semibold text-foreground" aria-live="polite">
      {shown !== null ? formatCurrency(shown) : '—'}
    </div>
  );
}
