import {
  type AwsMarketplaceProduct,
  parseAwsMarketplaceProducts,
} from '@/lib/billing/aws-marketplace/products'
import { env } from '@/lib/core/config/env'

let products: ReadonlyMap<string, AwsMarketplaceProduct> | undefined

/**
 * The products this deployment sells through AWS Marketplace, by product code. Empty on
 * self-hosted installs and every environment but production, which turns the Marketplace surfaces
 * off. A malformed setting throws a message naming the bad entry.
 */
export function getAwsMarketplaceProducts(): ReadonlyMap<string, AwsMarketplaceProduct> {
  products ??= env.AWS_MARKETPLACE_PRODUCTS
    ? parseAwsMarketplaceProducts(env.AWS_MARKETPLACE_PRODUCTS)
    : new Map()
  return products
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
