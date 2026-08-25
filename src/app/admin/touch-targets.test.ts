import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Task 10.9 - mobile touch-target regression guard.
 *
 * The project's established responsive standard (Task 1.14) is 44px minimum touch
 * targets, expressed as the min-h-11 Tailwind token. A Task 10.9 audit found three
 * consequential ADMIN mutation controls below it (payments Refund, categories
 * Activate/Deactivate, categories Edit-details summary - all min-h-9/text-xs), which
 * this suite now pins:
 *
 * 1. no admin page may reintroduce sub-standard interactive-control heights, and
 * 2. the three audited controls must carry the compliant token explicitly.
 */

const ADMIN_PAGES_DIR = join(process.cwd(), 'src', 'app', 'admin');

const SUB_STANDARD_HEIGHT_TOKENS = ['min-h-9', 'min-h-8', 'min-h-[36px]', 'h-9 ', 'h-8 '];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);

    return entry.isDirectory() ? walk(full) : /\.tsx$/.test(entry.name) ? [full] : [];
  });
}

describe('admin touch-target standard (Task 10.9)', () => {
  it('no admin page uses sub-standard control height tokens', () => {
    const offenders: Array<{ file: string; line: number; token: string }> = [];

    for (const file of walk(ADMIN_PAGES_DIR)) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);

      lines.forEach((line, index) => {
        for (const token of SUB_STANDARD_HEIGHT_TOKENS) {
          if (line.includes(token) && /button|summary|className/.test(line)) {
            offenders.push({ file, line: index + 1, token });
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('the consequential mutation controls audited in 10.9 meet the 44px standard', () => {
    const payments = readFileSync(join(ADMIN_PAGES_DIR, 'payments', 'page.tsx'), 'utf8');
    const categories = readFileSync(join(ADMIN_PAGES_DIR, 'categories', 'page.tsx'), 'utf8');

    // Payments refund button:
    expect(payments).toMatch(/type="submit"[^>]*>[\s\S]{0,40}Refund/);
    expect(payments).toContain('min-h-11 items-center rounded-lg border border-destructive/40');

    // Categories activate/deactivate button and edit-details disclosure:
    expect(categories).toContain(
      'inline-flex min-h-11 items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground'
    );
    expect(categories).toMatch(/<summary className="inline-flex min-h-11 cursor-pointer[^"]*">/);
  });
});
