import {
  type Entitlement,
  GetEntitlementsCommand,
} from '@aws-sdk/client-marketplace-entitlement-service'
import { compareStrings } from '@sim/utils/string'
import { getEntitlementClient } from '@/lib/billing/aws-marketplace/client'
import type { AwsMarketplaceProduct } from '@/lib/billing/aws-marketplace/products'

/** A license carries one entitlement per purchased dimension; this bounds a runaway `NextToken`. */
const MAX_PAGES = 20

/** What the last Entitlement Service read says about one license. */
export interface EntitlementSummary {
  /**
   * The product's required dimension (any dimension, for a plan with none) has an entitlement with
   * no expiry or one in the future.
   */
  active: boolean
  /** AWS returned an entitlement of any dimension: the license exists and names its account. */
  licenseSeen: boolean
  /**
   * AWS returned an entitlement, current or lapsed, for the dimension that grants access (any
   * dimension, for a plan with none). A usage dimension alone is not an answer about access, and
   * no answer is ambiguous: see the license's status.
   */
  accessReported: boolean
  dimension: string | null
  quantity: number | null
  expiresAt: Date | null
  customerAwsAccountId: string | null
}

function isCurrent(entitlement: Entitlement, now: Date): boolean {
  return !entitlement.ExpirationDate || entitlement.ExpirationDate.getTime() > now.getTime()
}

/**
 * Reduces a license's entitlements to the one the row records. Only the plan's required dimension
 * counts, when it names one; usage dimensions on the same license never grant access. A current
 * entitlement wins, the lowest dimension name first so repeated reads agree; with none current,
 * the latest-expiring one still describes what lapsed. Quantity is read only from an integer
 * value: a contract's dollar amount is never inferred from it.
 */
function summarizeEntitlements(
  allEntitlements: readonly Entitlement[],
  requiredDimension: string | null,
  now: Date
): EntitlementSummary {
  const entitlements = requiredDimension
    ? allEntitlements.filter((entitlement) => entitlement.Dimension === requiredDimension)
    : allEntitlements
  const current = entitlements
    .filter((entitlement) => isCurrent(entitlement, now))
    .sort((left, right) => compareStrings(left.Dimension ?? '', right.Dimension ?? ''))
  const lapsed = [...entitlements].sort(
    (left, right) =>
      (right.ExpirationDate?.getTime() ?? 0) - (left.ExpirationDate?.getTime() ?? 0) ||
      compareStrings(left.Dimension ?? '', right.Dimension ?? '')
  )
  const chosen = current[0] ?? lapsed[0]
  return {
    active: current.length > 0,
    licenseSeen: allEntitlements.length > 0,
    accessReported: entitlements.length > 0,
    dimension: chosen?.Dimension ?? null,
    quantity: chosen?.Value?.IntegerValue ?? null,
    expiresAt: chosen?.ExpirationDate ?? null,
    customerAwsAccountId:
      chosen?.CustomerAWSAccountId ?? allEntitlements[0]?.CustomerAWSAccountId ?? null,
  }
}

/**
 * The Entitlement Service rejected the request itself (a malformed license ARN or product code).
 * Asking again cannot succeed; every other failure, including a misconfigured IAM grant, may.
 */
export function isInvalidEntitlementRequest(error: unknown): boolean {
  return error instanceof Error && error.name === 'InvalidParameterException'
}

/** Every entitlement AWS holds for one license of our product, across all pages. */
async function fetchLicenseEntitlements(
  productCode: string,
  licenseArn: string,
  signal?: AbortSignal
): Promise<Entitlement[]> {
  const entitlements: Entitlement[] = []
  let nextToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await getEntitlementClient().send(
      new GetEntitlementsCommand({
        ProductCode: productCode,
        Filter: { LICENSE_ARN: [licenseArn] },
        NextToken: nextToken,
      }),
      { abortSignal: signal }
    )
    entitlements.push(...(result.Entitlements ?? []))
    nextToken = result.NextToken
    if (!nextToken) return entitlements
  }
  throw new Error(`GetEntitlements returned more than ${MAX_PAGES} pages for one license`)
}

/** Reads and summarizes one license's entitlements as of now; `signal` bounds the whole read. */
export async function verifyLicense(
  product: AwsMarketplaceProduct,
  licenseArn: string,
  signal?: AbortSignal
): Promise<EntitlementSummary> {
  const entitlements = await fetchLicenseEntitlements(product.productCode, licenseArn, signal)
  return summarizeEntitlements(entitlements, product.plan.requiredDimension, new Date())
}
