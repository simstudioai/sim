import {
  type Entitlement,
  GetEntitlementsCommand,
} from '@aws-sdk/client-marketplace-entitlement-service'
import { compareStrings } from '@sim/utils/string'
import { getEntitlementClient } from '@/lib/billing/aws-marketplace/client'

/** A license carries one entitlement per purchased dimension; this bounds a runaway `NextToken`. */
const MAX_PAGES = 20

/** What the last Entitlement Service read says about one license. */
export interface EntitlementSummary {
  /** At least one entitlement has no expiry or expires in the future. */
  active: boolean
  /** Entitlements AWS returned, current or lapsed; zero is ambiguous, see the license's status. */
  entitlementCount: number
  dimension: string | null
  quantity: number | null
  expiresAt: Date | null
  customerAwsAccountId: string | null
}

function isCurrent(entitlement: Entitlement, now: Date): boolean {
  return !entitlement.ExpirationDate || entitlement.ExpirationDate.getTime() > now.getTime()
}

/**
 * Reduces a license's entitlements to the one the row records. A current entitlement wins, the
 * lowest dimension name first so repeated reads agree; with none current, the latest-expiring one
 * still describes what lapsed. Quantity is read only from an integer value: a contract's dollar
 * amount is never inferred from it.
 */
function summarizeEntitlements(
  entitlements: readonly Entitlement[],
  now: Date
): EntitlementSummary {
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
    entitlementCount: entitlements.length,
    dimension: chosen?.Dimension ?? null,
    quantity: chosen?.Value?.IntegerValue ?? null,
    expiresAt: chosen?.ExpirationDate ?? null,
    customerAwsAccountId: chosen?.CustomerAWSAccountId ?? null,
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
  productCode: string,
  licenseArn: string,
  signal?: AbortSignal
): Promise<EntitlementSummary> {
  const entitlements = await fetchLicenseEntitlements(productCode, licenseArn, signal)
  return summarizeEntitlements(entitlements, new Date())
}
