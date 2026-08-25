/**
 * Bid console submit pipeline (UI redesign task).
 *
 * Pure and dependency-injected (fetch passed in) so the exact browser contract is
 * deterministically testable. The payload contains ONLY the public product identifier
 * plus an optional category - an amount field cannot exist here because the server
 * derives it authoritatively.
 */

export type SubmitBidInput = {
  product: string;
  categorySlug?: string | null;
};

export type SubmitBidOutcome =
  { ok: true; url: string } | { ok: false; error: string; minimumBid?: number | null };

export function isNonEmptyProductInput(product: string): boolean {
  return typeof product === 'string' && product.trim().length > 0;
}

export async function submitBid(
  input: SubmitBidInput,
  fetchImpl: typeof fetch = fetch
): Promise<SubmitBidOutcome> {
  if (!isNonEmptyProductInput(input.product)) {
    return { ok: false, error: 'invalid_product' };
  }

  try {
    const response = await fetchImpl('/api/bids/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: input.product.trim(),
        ...(input.categorySlug ? { categorySlug: input.categorySlug } : {}),
      }),
    });

    let body: { url?: unknown; error?: unknown; minimumBid?: unknown } = {};

    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Non-JSON failure page - fall through to the generic branch below.
    }

    if (response.ok && typeof body.url === 'string' && body.url) {
      return { ok: true, url: body.url };
    }

    return {
      ok: false,
      error: typeof body.error === 'string' ? body.error : 'checkout_failed',
      minimumBid: typeof body.minimumBid === 'number' ? body.minimumBid : null,
    };
  } catch {
    return { ok: false, error: 'network_failed' };
  }
}
