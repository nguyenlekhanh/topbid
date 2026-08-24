import type { Category } from '@/lib/categories';
import { createServiceClient } from '@/lib/supabase-service';
import { getAdminAuthorization } from '@/lib/admin-auth';

/**
 * Server-only category management (Task 8.3).
 *
 * Every mutation authorizes through the Task 8.1 boundary (getAdminAuthorization)
 * BEFORE touching the database and fails closed on any authorization problem.
 *
 * Persistence uses the established service-role client pattern: public RLS grants
 * admins no write path (by design - anon/authenticated are read-only), so management
 * writes go through the service role inside this server-only module. The browser
 * never sees credentials; pages/routes call these functions and render typed results.
 *
 * Field policy:
 * - slug is REQUIRED at creation and IMMUTABLE afterwards: public /categories/[slug]
 *   URLs (Task 7.4) are user-shared assets whose stability outweighs rename freedom
 * - Updatable: name, description, starting_bid, increment, image_url, is_active;
 *   updated_at is maintained server-side
 * - All monetary values are INTEGER CENTS validated server-side (>= 0); dollar-string
 *   inputs are converted with an exact regex + rounding; browser input is treated as
 *   untrusted display hints, never authority
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 80;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_IMAGE_URL_LENGTH = 2048;
const DOLLARS_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

export type CategoryManagementErrorReason =
  'unauthorized' | 'invalid_input' | 'slug_taken' | 'not_found' | 'db_error';

export type CategoryManagementResult =
  { ok: true } | { ok: false; reason: CategoryManagementErrorReason };

/** Parse a whole/2-decimal dollar string (optional leading $) into integer cents. */
export function parseDollarsToCents(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const withoutCurrency = value.trim().replace(/^\$/, '');

  if (!DOLLARS_PATTERN.test(withoutCurrency)) {
    return null;
  }

  return Math.round(Number.parseFloat(withoutCurrency) * 100);
}

type CentsInput = number | undefined;

function resolveCents(value: unknown, input: CentsInput = undefined): number | null {
  // Explicit numeric cents take precedence (typed callers); otherwise dollar strings.
  if (input !== undefined) {
    return Number.isInteger(input) && input >= 0 ? input : null;
  }

  return parseDollarsToCents(value);
}

function normalizeSlug(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (!trimmed || trimmed.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function normalizeName(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  return trimmed && trimmed.length <= MAX_NAME_LENGTH ? trimmed : null;
}

function normalizeDescription(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  return trimmed ? trimmed.slice(0, MAX_DESCRIPTION_LENGTH) : null;
}

type ImageUrlResolution =
  { kind: 'absent' } | { kind: 'invalid' } | { kind: 'set'; url: string | null };

function resolveImageUrl(value: unknown): ImageUrlResolution {
  if (value === undefined) {
    return { kind: 'absent' };
  }

  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!trimmed) {
    return { kind: 'set', url: null };
  }

  if (trimmed.length > MAX_IMAGE_URL_LENGTH || !/^https?:\/\//i.test(trimmed)) {
    return { kind: 'invalid' };
  }

  return { kind: 'set', url: trimmed };
}

export type CreateCategoryInput = {
  slug: unknown;
  name: unknown;
  description?: unknown;
  startingBid?: unknown;
  increment?: unknown;
  imageUrl?: unknown;
};

/**
 * Create a category (is_active defaults true). Duplicate slugs race-safe via the
 * UNIQUE(slug) constraint - PostgreSQL guarantees exactly one winner and violations
 * map to the stable 'slug_taken' reason.
 */
export async function createAdminCategory(
  input: CreateCategoryInput
): Promise<CategoryManagementResult> {
  if (!(await getAdminAuthorization()).authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const slug = normalizeSlug(input.slug);
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description);
  const startingBid = resolveCents(input.startingBid);
  const increment = resolveCents(input.increment);
  const imageUrl = resolveImageUrl(input.imageUrl);

  if (!slug || !name || startingBid === null || increment === null || imageUrl.kind === 'invalid') {
    return { ok: false, reason: 'invalid_input' };
  }

  const supabase = createServiceClient();

  const { error } = await supabase.from('categories').insert({
    slug,
    name,
    description,
    starting_bid: startingBid,
    increment,
    image_url: imageUrl.kind === 'set' ? imageUrl.url : null,
    is_active: true,
  });

  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'slug_taken' };
    }

    console.error('[admin-categories] create failed:', error.message);

    return { ok: false, reason: 'db_error' };
  }

  return { ok: true };
}

export type UpdateCategoryInput = {
  /** Stable primary key of the category to modify. */
  id: unknown;
  name?: unknown;
  description?: unknown;
  startingBid?: unknown;
  increment?: unknown;
  imageUrl?: unknown;
};

/** Update mutable details of an existing category (slug is never touched). */
export async function updateAdminCategory(
  input: UpdateCategoryInput
): Promise<CategoryManagementResult> {
  if (!(await getAdminAuthorization()).authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const id = normalizeId(input.id);

  if (!id) {
    return { ok: false, reason: 'invalid_input' };
  }

  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = normalizeName(input.name);

    if (!name) {
      return { ok: false, reason: 'invalid_input' };
    }

    patch.name = name;
  }

  if (input.description !== undefined) {
    patch.description = normalizeDescription(input.description);
  }

  if (input.startingBid !== undefined) {
    const cents = resolveCents(input.startingBid);

    if (cents === null) {
      return { ok: false, reason: 'invalid_input' };
    }

    patch.starting_bid = cents;
  }

  if (input.increment !== undefined) {
    const cents = resolveCents(input.increment);

    if (cents === null) {
      return { ok: false, reason: 'invalid_input' };
    }

    patch.increment = cents;
  }

  const imageUrl = resolveImageUrl(input.imageUrl);

  if (imageUrl.kind === 'invalid') {
    return { ok: false, reason: 'invalid_input' };
  }

  if (imageUrl.kind === 'set') {
    patch.image_url = imageUrl.url;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, reason: 'invalid_input' };
  }

  patch.updated_at = new Date().toISOString();

  const supabase = createServiceClient();

  const { data, error } = await supabase.from('categories').update(patch).eq('id', id).select('id');

  if (error) {
    console.error('[admin-categories] update failed:', error.message);

    return { ok: false, reason: 'db_error' };
  }

  if ((Array.isArray(data) ? data : []).length === 0) {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true };
}

/**
 * Activate/deactivate a category. Deactivation hides it from every public surface
 * (homepage grid, /categories/[slug] -> 404) while preserving its row and bids.
 */
export async function setCategoryActive(input: {
  id: unknown;
  active: unknown;
}): Promise<CategoryManagementResult> {
  if (!(await getAdminAuthorization()).authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const id = normalizeId(input.id);
  const active =
    input.active === true || input.active === 'true'
      ? true
      : input.active === false || input.active === 'false'
        ? false
        : null;

  if (!id || active === null) {
    return { ok: false, reason: 'invalid_input' };
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('categories')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');

  if (error) {
    console.error('[admin-categories] set-active failed:', error.message);

    return { ok: false, reason: 'db_error' };
  }

  if ((Array.isArray(data) ? data : []).length === 0) {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true };
}

/**
 * Full category list INCLUDING inactive rows - management requires seeing
 * deactivated categories to re-activate/edit them, and public RLS hides those.
 * Isolated server-only read (service role) behind the same authorization gate,
 * ordered newest-last for stable display.
 */
export async function listAllCategoriesForAdmin(): Promise<
  { ok: true; categories: Category[] } | { ok: false; reason: CategoryManagementErrorReason }
> {
  if (!(await getAdminAuthorization()).authorized) {
    return { ok: false, reason: 'unauthorized' };
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[admin-categories] list failed:', error.message);

    return { ok: false, reason: 'db_error' };
  }

  return { ok: true, categories: (data as Category[]) ?? [] };
}

function normalizeId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' || /duplicate key/i.test(error.message ?? '');
}
