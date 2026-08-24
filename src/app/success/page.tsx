import type { Metadata } from 'next';

import SuccessState from '@/components/SuccessState';
import { getBidByStripeSessionId } from '@/lib/bids';

export const metadata: Metadata = {
  title: 'Bid success — Topbid.lol',
};

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;

  // Authoritative lookup only: the identifier arrives from the URL and is treated as
  // untrusted; every displayed value is read back from the database. Under RLS a bid
  // that is still 'pending' (webhook not yet processed) is not publicly readable, so
  // this renders a neutral awaiting-confirmation state - visiting this page never
  // confirms payment or marks a bid paid.
  const result = sessionId ? await getBidByStripeSessionId(sessionId) : null;

  // Sanitized echo of the untrusted URL parameter for the reference line only.
  const pendingReference = sessionId?.trim().slice(0, 64);

  return (
    <section className="py-12 sm:py-16" aria-label="Bid success">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          {result ? (
            <SuccessState
              title="Payment confirmed!"
              description="Your bid has been verified and recorded on the leaderboard."
              amount={formatAmount(result.bid.amount)}
              category={result.category?.name ?? undefined}
              reference={result.bid.stripe_session_id ?? undefined}
              note="Keep this reference for your records."
            />
          ) : (
            <SuccessState
              title="Payment received"
              description="We're confirming your payment with Stripe. Your bid will appear on the leaderboard as soon as it is verified — this usually takes only a few seconds. You can safely close this page."
              reference={pendingReference}
              note="This page does not confirm your payment; verification happens automatically."
            />
          )}
        </div>
      </div>
    </section>
  );
}
