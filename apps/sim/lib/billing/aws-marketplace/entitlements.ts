import {
  type Entitlement,
  GetEntitlementsCommand,
  type GetEntitlementsCommandOutput,
} from '@aws-sdk/client-marketplace-entitlement-service'
import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { compareStrings } from '@sim/utils/string'
import { getEntitlementClient } from '@/lib/billing/aws-marketplace/client'

const MAX_ATTEMPTS = 3
const RETRY_BACKOFF = { baseMs: 200, maxMs: 2_000 }
/** A license carries one entitlement per purchased dimension; this bounds a runaway `NextToken`. */
const MAX_PAGES = 20

/** What the last Entitlement Service read says about one license. */
export interface EntitlementSummary {
  /** At least one entitlement for our product has no expiry or expires in the future. */
  active: boolean
  /** Entitlements AWS returned for our product, current or lapsed; zero once deprovisioned. */
  entitlementCount: number
  dimension: string | null
  quantity: number | null
  expiresAt: Date | null
  customerIdentifier: string | null
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
export function summarizeEntitlements(
  entitlements: readonly Entitlement[],
  productCode: string,
  now: Date
): EntitlementSummary {
  const ours = entitlements.filter((entitlement) => entitlement.ProductCode === productCode)
  const current = ours
    .filter((entitlement) => isCurrent(entitlement, now))
    .sort((left, right) => compareStrings(left.Dimension ?? '', right.Dimension ?? ''))
  const lapsed = [...ours].sort(
    (left, right) => (right.ExpirationDate?.getTime() ?? 0) - (left.ExpirationDate?.getTime() ?? 0)
  )
  const chosen = current[0] ?? lapsed[0]
  const integerValue = chosen?.Value?.IntegerValue
  return {
    active: current.length > 0,
    entitlementCount: ours.length,
    dimension: chosen?.Dimension ?? null,
    quantity:
      typeof integerValue === 'number' && Number.isInteger(integerValue) ? integerValue : null,
    expiresAt: chosen?.ExpirationDate ?? null,
    customerIdentifier: chosen?.CustomerIdentifier ?? null,
    customerAwsAccountId: chosen?.CustomerAWSAccountId ?? null,
  }
}

interface AwsServiceErrorShape {
  name?: string
  $metadata?: { httpStatusCode?: number }
}

/** Throttling, a server fault, or no HTTP response at all (network, timeout). */
function isRetryable(error: unknown): boolean {
  const shape = error as AwsServiceErrorShape
  if (shape?.name === 'ThrottlingException' || shape?.name === 'InternalServiceErrorException') {
    return true
  }
  const status = shape?.$metadata?.httpStatusCode
  if (typeof status !== 'number') return true
  return status === 429 || status >= 500
}

/**
 * The Entitlement Service rejected the request itself (a malformed license ARN or product code).
 * Asking again cannot succeed; every other failure, including a misconfigured IAM grant, may.
 */
export function isInvalidEntitlementRequest(error: unknown): boolean {
  return (error as AwsServiceErrorShape)?.name === 'InvalidParameterException'
}

async function getEntitlementsPage(
  command: GetEntitlementsCommand,
  signal?: AbortSignal
): Promise<GetEntitlementsCommandOutput> {
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted()
    try {
      return await getEntitlementClient().send(command, { abortSignal: signal })
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(error) || signal?.aborted) throw error
      await interruptibleSleep(backoffWithJitter(attempt, null, RETRY_BACKOFF), signal)
    }
  }
}

/** Every entitlement AWS holds for one license of our product, across all pages. */
export async function fetchLicenseEntitlements(
  productCode: string,
  licenseArn: string,
  signal?: AbortSignal
): Promise<Entitlement[]> {
  const entitlements: Entitlement[] = []
  let nextToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await getEntitlementsPage(
      new GetEntitlementsCommand({
        ProductCode: productCode,
        Filter: { LICENSE_ARN: [licenseArn] },
        NextToken: nextToken,
      }),
      signal
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
  return summarizeEntitlements(entitlements, productCode, new Date())
}
