import {
  type AwsMarketplaceProduct,
  parseAwsMarketplaceProducts,
} from '@/lib/billing/aws-marketplace/products'
import { env } from '@/lib/core/config/env'

/** Parsed once per distinct setting; env validation already rejected a malformed one at boot. */
let parsed: { raw: string | undefined; products: ReadonlyMap<string, AwsMarketplaceProduct> } = {
  raw: undefined,
  products: new Map(),
}

/**
 * The products this deployment sells through AWS Marketplace, by product code. Empty on
 * self-hosted installs and every environment but production, which turns the registration, claim,
 * and reconcile surfaces off.
 */
export function getAwsMarketplaceProducts(): ReadonlyMap<string, AwsMarketplaceProduct> {
  const raw = env.AWS_MARKETPLACE_PRODUCTS
  if (parsed.raw !== raw) {
    parsed = { raw, products: raw ? parseAwsMarketplaceProducts(raw) : new Map() }
  }
  return parsed.products
}

export function isAwsMarketplaceEnabled(): boolean {
  return getAwsMarketplaceProducts().size > 0
}

/** The configured product for a code AWS returned or a license row stored; null for any other. */
export function findAwsMarketplaceProduct(
  productCode: string | null | undefined
): AwsMarketplaceProduct | null {
  return productCode ? (getAwsMarketplaceProducts().get(productCode) ?? null) : null
}

/** Every configured product code, for queries that span all of them. */
export function getAwsMarketplaceProductCodes(): string[] {
  return [...getAwsMarketplaceProducts().keys()]
}
