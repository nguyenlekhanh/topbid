import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {/* config options here */};

/**
 * Task 10.7 - Sentry wrapper for production source-map upload and SDK integration.
 *
 * - SENTRY_AUTH_TOKEN is BUILD-ONLY: it is read here (build time) for secure source-map
 *   uploads to the Sentry dashboard and is never referenced by application code, never
 *   inlined into client bundles, and never committed
 * - Without a token the wrapper silently skips uploads, keeping builds green on
 *   machines/previews without monitoring credentials
 */
const sentryWrappedConfig = withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  disableLogger: true,
});

export default sentryWrappedConfig;
