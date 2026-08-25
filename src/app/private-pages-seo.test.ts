import { describe, expect, it } from 'vitest';

import { NO_INDEX } from '@/lib/seo';
// Page modules are imported for their static metadata exports only; none of them
// execute database/auth work at module scope (all such work happens inside request
// handlers), so importing them here is side-effect-free.
import { metadata as adminMetadata } from './admin/page';
import { metadata as adminBannedMetadata } from './admin/banned/page';
import { metadata as adminBidsMetadata } from './admin/bids/page';
import { metadata as adminCategoriesMetadata } from './admin/categories/page';
import { metadata as auditLogsMetadata } from './admin/audit-logs/page';
import { metadata as loginMetadata } from './admin/login/page';
import { metadata as paymentsMetadata } from './admin/payments/page';
import { metadata as cancelMetadata } from './cancel/page';
import { metadata as successMetadata } from './success/page';
import { metadata as unsubscribeMetadata } from './unsubscribe/page';

/**
 * Task 10.5 - private-surface indexing tests.
 *
 * Every non-SEO/private page must carry the exact shared NO_INDEX directive
 * (robots: noindex, nofollow) so search engines never list payment results,
 * capability-token surfaces, or any admin/authentication screen.
 */
const PRIVATE_PAGES: Array<[string, { robots?: unknown }]> = [
  ['/success', successMetadata],
  ['/cancel', cancelMetadata],
  ['/unsubscribe', unsubscribeMetadata],
  ['/admin', adminMetadata],
  ['/admin/login', loginMetadata],
  ['/admin/categories', adminCategoriesMetadata],
  ['/admin/bids', adminBidsMetadata],
  ['/admin/payments', paymentsMetadata],
  ['/admin/banned', adminBannedMetadata],
  ['/admin/audit-logs', auditLogsMetadata],
];

describe('private pages are not indexable (Task 10.5)', () => {
  it.each(PRIVATE_PAGES)('%s carries the shared noindex directive', (_path, metadata) => {
    // The exact shared directive - no hand-copied variants anywhere.
    expect(metadata.robots).toEqual(NO_INDEX.robots);

    const robots = metadata.robots as { index?: boolean; follow?: boolean };
    expect(robots.index).toBe(false);
    expect(robots.follow).toBe(false);
  });

  it('covers every private surface in this application', () => {
    expect(PRIVATE_PAGES.map(([path]) => path)).toEqual([
      '/success',
      '/cancel',
      '/unsubscribe',
      '/admin',
      '/admin/login',
      '/admin/categories',
      '/admin/bids',
      '/admin/payments',
      '/admin/banned',
      '/admin/audit-logs',
    ]);
  });
});
