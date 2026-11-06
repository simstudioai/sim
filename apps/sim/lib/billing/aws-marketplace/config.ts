import { env } from '@/lib/core/config/env'

/**
 * The SaaS product code, or null when this deployment does not sell through AWS Marketplace:
 * self-hosted installs and every environment but production. Null turns the registration,
 * claim, and reconcile surfaces off.
 */
export function getAwsMarketplaceProductCode(): string | null {
  return env.AWS_MARKETPLACE_PRODUCT_CODE ?? null
}
