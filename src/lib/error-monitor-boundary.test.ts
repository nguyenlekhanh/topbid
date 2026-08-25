import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Task 10.7 - build-boundary guard tests.
 *
 * SENTRY_AUTH_TOKEN is a build-only secret (source-map upload inside
 * next.config.ts). These tests pin that it is NEVER referenced by any application
 * source file, so it can never be inlined into client bundles.
 */

const SRC_ROOT = join(process.cwd(), 'src');
const SELF = 'error-monitor-boundary.test';

describe('build-only credential boundary (Task 10.7)', () => {
  it('the upload-token literal never appears in application source', () => {
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(SELF)) {
          // This guard file must mention the literal to assert on it; every OTHER
          // application/test source file must be free of it.
          if (readFileSync(full, 'utf8').includes('SENTRY_AUTH_TOKEN')) {
            offenders.push(full);
          }
        }
      }
    }

    walk(SRC_ROOT);

    expect(offenders).toEqual([]);
  });

  it('the build wrapper reads the token only inside next.config.ts', () => {
    expect(readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8')).toContain(
      'process.env.SENTRY_AUTH_TOKEN'
    );
  });
});
