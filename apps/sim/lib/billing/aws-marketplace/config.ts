import {
  type AwsMarketplaceProduct,
  type AwsMarketplaceProducts,
  parseAwsMarketplaceProducts,
} from '@/lib/billing/aws-marketplace/products'
import { env } from '@/lib/core/config/env'

let products: AwsMarketplaceProducts | undefined

/**
 * The products this deployment sells through AWS Marketplace, by product code. Empty on
 * self-hosted installs and every environment but production, which turns the Marketplace surfaces
 * off. The container entrypoint refuses to start on a malformed setting.
 */
export function getAwsMarketplaceProducts(): AwsMarketplaceProducts {
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
