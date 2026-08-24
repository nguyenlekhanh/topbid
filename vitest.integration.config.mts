import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Integration test config (Task 4.12).
 *
 * Run with: npm run test:integration
 *
 * These tests exercise REAL boundaries - Stripe test-mode APIs and the Supabase
 * service-role database - and therefore only execute when the operator explicitly opts
 * in by setting RUN_STRIPE_INTEGRATION=true together with valid test-mode credentials:
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   NEXT_PUBLIC_APP_URL
 *
 * Never point these tests at production/live credentials.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
