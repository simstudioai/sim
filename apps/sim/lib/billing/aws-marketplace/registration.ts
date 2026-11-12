import {
  ResolveCustomerCommand,
  type ResolveCustomerCommandOutput,
} from '@aws-sdk/client-marketplace-metering'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { AWS_MARKETPLACE_CLAIM_TTL_MS, issueClaimToken } from '@/lib/billing/aws-marketplace/claim'
import { getMeteringClient } from '@/lib/billing/aws-marketplace/client'
import { findAwsMarketplaceProduct } from '@/lib/billing/aws-marketplace/config'
import { type EntitlementSummary, verifyLicense } from '@/lib/billing/aws-marketplace/entitlements'
import type { AwsMarketplaceOnboardingError } from '@/lib/billing/aws-marketplace/onboarding'
import type { AwsMarketplaceProduct } from '@/lib/billing/aws-marketplace/products'
import { saveRegisteredLicense } from '@/lib/billing/aws-marketplace/repository'

const logger = createLogger('AwsMarketplaceRegistration')

/** Token failures the buyer can fix only by starting again from AWS Marketplace. */
const REJECTED_TOKEN_ERRORS = new Set(['InvalidTokenException', 'ExpiredTokenException'])

/** The buyer's browser is waiting, so AWS gets only a moment to finish after a purchase. */
const NO_ENTITLEMENT_RETRY_DELAYS_MS = [500, 1_000]

type AwsMarketplaceRegistration =
  | { kind: 'claimed'; claimToken: string }
  | { kind: AwsMarketplaceOnboardingError }

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined
}

/** AWS may not have finished right after a purchase, so a read with no answer about access is asked again briefly. */
async function readEntitlements(
  product: AwsMarketplaceProduct,
  licenseArn: string
): Promise<{ summary: EntitlementSummary; verifiedAt: Date }> {
  let verifiedAt = new Date()
  let summary = await verifyLicense(product, licenseArn)
  for (const delayMs of NO_ENTITLEMENT_RETRY_DELAYS_MS) {
    if (summary.accessReported) break
    await sleep(delayMs)
    verifiedAt = new Date()
    summary = await verifyLicense(product, licenseArn)
  }
  return { summary, verifiedAt }
}

/**
 * Turns the registration token AWS posts to the fulfillment URL into a license row. Every listing
 * shares the one fulfillment URL, so the product comes from the code AWS resolves the token to,
 * and a code this deployment does not sell is refused. Every registration reads the license's
 * entitlements. A license AWS has not confirmed yet still gets a claim, so the buyer can leave
 * contact details; only a lapsed one does not. The token itself is never logged.
 */
export async function registerAwsMarketplaceBuyer(
  registrationToken: string
): Promise<AwsMarketplaceRegistration> {
  let customer: ResolveCustomerCommandOutput
  try {
    customer = await getMeteringClient().send(
      new ResolveCustomerCommand({ RegistrationToken: registrationToken })
    )
  } catch (error) {
    const name = errorName(error)
    if (name && REJECTED_TOKEN_ERRORS.has(name)) {
      logger.warn('AWS Marketplace rejected a registration token', { reason: name })
      return { kind: 'invalid' }
    }
    logger.error('Could not resolve an AWS Marketplace customer', { reason: name })
    return { kind: 'unavailable' }
  }

  const product = findAwsMarketplaceProduct(customer.ProductCode)
  if (!product) {
    logger.warn('AWS Marketplace registration is for another product')
    return { kind: 'invalid' }
  }
  // New SaaS integrations get no CustomerIdentifier; the account ID and license ARN name the buyer.
  if (!customer.CustomerAWSAccountId) {
    logger.warn('AWS Marketplace registration resolved without an account')
    return { kind: 'invalid' }
  }
  // A future-dated agreement gets its ARN on its start date; the License Updated event records it.
  if (!customer.LicenseArn) {
    logger.info('AWS Marketplace registration is for an agreement that has not started')
    return { kind: 'not-started' }
  }

  try {
    const verification = await readEntitlements(product, customer.LicenseArn)
    const claim = issueClaimToken()
    const saved = await saveRegisteredLicense({
      licenseArn: customer.LicenseArn,
      productCode: product.productCode,
      customerAwsAccountId: customer.CustomerAWSAccountId,
      agreementId: customer.Metadata?.AgreementId ?? null,
      verification,
      claim: { hash: claim.hash, expiresAt: new Date(Date.now() + AWS_MARKETPLACE_CLAIM_TTL_MS) },
    })
    logger.info('Registered an AWS Marketplace license', {
      licenseId: saved.id,
      status: saved.status,
    })
    return saved.status === 'inactive'
      ? { kind: 'no-subscription' }
      : { kind: 'claimed', claimToken: claim.token }
  } catch (error) {
    logger.error('Could not record an AWS Marketplace registration', {
      reason: errorName(error),
      message: getErrorMessage(error, 'Unknown error'),
    })
    return { kind: 'unavailable' }
  }
}
