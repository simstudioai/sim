import {
  ResolveCustomerCommand,
  type ResolveCustomerCommandOutput,
} from '@aws-sdk/client-marketplace-metering'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { AWS_MARKETPLACE_CLAIM_TTL_MS, issueClaimToken } from '@/lib/billing/aws-marketplace/claim'
import { getMeteringClient } from '@/lib/billing/aws-marketplace/client'
import { type EntitlementSummary, verifyLicense } from '@/lib/billing/aws-marketplace/entitlements'
import type { AwsMarketplaceOnboardingError } from '@/lib/billing/aws-marketplace/onboarding'
import { saveRegisteredLicense } from '@/lib/billing/aws-marketplace/repository'

const logger = createLogger('AwsMarketplaceRegistration')

/** Token failures the buyer can fix only by starting again from AWS Marketplace. */
const REJECTED_TOKEN_ERRORS = new Set(['InvalidTokenException', 'ExpiredTokenException'])

type AwsMarketplaceRegistration =
  | { kind: 'claimed'; claimToken: string }
  | { kind: AwsMarketplaceOnboardingError }

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined
}

/**
 * Turns the registration token AWS posts to the fulfillment URL into a license row. Every
 * registration reads the license's entitlements, active or not, and only an active license
 * gets a claim the buyer can link to an organization. The token itself is never logged.
 */
export async function registerAwsMarketplaceBuyer(
  productCode: string,
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
    logger.error('Could not resolve an AWS Marketplace customer', {
      reason: name,
      message: getErrorMessage(error, 'Unknown error'),
    })
    return { kind: 'unavailable' }
  }

  if (customer.ProductCode !== productCode) {
    logger.warn('AWS Marketplace registration is for another product')
    return { kind: 'invalid' }
  }
  if (!customer.CustomerIdentifier || !customer.LicenseArn) {
    logger.warn('AWS Marketplace registration resolved without a customer or license', {
      hasCustomer: Boolean(customer.CustomerIdentifier),
      hasLicense: Boolean(customer.LicenseArn),
    })
    return { kind: 'invalid' }
  }

  const verifiedAt = new Date()
  let summary: EntitlementSummary
  try {
    summary = await verifyLicense(productCode, customer.LicenseArn)
  } catch (error) {
    logger.error('Could not read entitlements for an AWS Marketplace registration', {
      reason: errorName(error),
      message: getErrorMessage(error, 'Unknown error'),
    })
    return { kind: 'unavailable' }
  }

  const claim = summary.active ? issueClaimToken() : null
  const licenseId = await saveRegisteredLicense({
    licenseArn: customer.LicenseArn,
    productCode,
    customerIdentifier: customer.CustomerIdentifier,
    customerAwsAccountId: customer.CustomerAWSAccountId ?? null,
    summary,
    verifiedAt,
    claim: claim
      ? { hash: claim.hash, expiresAt: new Date(Date.now() + AWS_MARKETPLACE_CLAIM_TTL_MS) }
      : null,
  })
  logger.info('Registered an AWS Marketplace license', { licenseId, active: summary.active })
  return claim ? { kind: 'claimed', claimToken: claim.token } : { kind: 'no-subscription' }
}
