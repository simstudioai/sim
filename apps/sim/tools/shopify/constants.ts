/**
 * The Shopify Admin API version every Sim Shopify tool targets, plus the
 * credential validator in
 * `@/lib/credentials/token-service-accounts/validators/shopify`. Keep this the
 * single source of truth — bump it here and every caller moves in lockstep.
 *
 * Shopify supports each stable version for at least 12 months and forward-falls
 * to the oldest supported version for retired ones, so a request never breaks
 * the day a version retires — but the served version drifts silently, so pin an
 * explicitly supported version and bump on the quarterly cadence.
 *
 * @see https://shopify.dev/docs/api/usage/versioning
 */
export const SHOPIFY_API_VERSION = '2025-10'
