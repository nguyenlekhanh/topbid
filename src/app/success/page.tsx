import type { Metadata } from 'next';

import SuccessState from '@/components/SuccessState';
import { extractSessionId, resolveBidSuccessView } from '@/lib/bid-success';
import { getBidByStripeSessionId } from '@/lib/bids';
import { buildXShareText, buildXShareUrl } from '@/lib/x-share';

export const metadata: Metadata = {
  title: 'Bid success — Topbid.lol',
};

function formatAmount(amountCents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

function getAppBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;

  if (!base || !base.trim()) {
    throw new Error('Missing NEXT_PUBLIC_APP_URL: required to build the X share link');
  }

  return base.trim().replace(/\/+$/, '');
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Authoritative lookup only: the identifier arrives from the URL and is treated as
  // untrusted (shape-validated, single value only); every displayed value is read back
  // from the database. Under RLS a bid that is still 'pending' (webhook not yet
  // processed) is not publicly readable, so this renders a neutral
  // awaiting-confirmation state - visiting this page never confirms payment or marks a
  // bid paid.
  const sessionId = extractSessionId(await searchParams);
  const result = sessionId ? await getBidByStripeSessionId(sessionId) : null;
  const view = resolveBidSuccessView(sessionId, result);

  // Task 7.2: share intent built server-side from AUTHORITATIVE data only. The shared
  // URL is the public leaderboard anchor (an existing convention) - never the
  // /success session URL, so no Stripe identifiers ever reach the social share.
  const xShareUrl =
    view.view === 'confirmed'
      ? buildXShareUrl({
          text: buildXShareText({
            amountCents: view.amountCents,
            categoryName: view.categoryName,
          }),
          url: `${getAppBaseUrl()}/#leaderboard-heading`,
        })
      : undefined;

  return (
    <section className="py-12 sm:py-16" aria-label="Bid success">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          {view.view === 'confirmed' ? (
            <SuccessState
              title="Payment confirmed!"
              description="Your bid has been verified and recorded on the leaderboard."
              amount={formatAmount(view.amountCents)}
              category={view.categoryName ?? undefined}
              reference={view.reference || undefined}
              note="Keep this reference for your records."
              xShareUrl={xShareUrl}
            />
          ) : (
            <SuccessState
              title="Payment received"
              description="We're confirming your payment with Stripe. Your bid will appear on the leaderboard as soon as it is verified — this usually takes only a few seconds. You can safely close this page."
              reference={view.reference ?? undefined}
              note="This page does not confirm your payment; verification happens automatically."
            />
          )}
        </div>
      </div>
    </section>
  );
}
