import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { APIError } from 'better-auth/api'
import { type AtomicClaimResult, IdempotencyService } from '@/lib/core/idempotency/service'

const logger = createLogger('BillingCheckoutAdmission')

const CHECKOUT_ADMISSION_LEASE_SECONDS = 2 * 60

const checkoutAdmissionLeases = new IdempotencyService({
  namespace: 'billing-checkout-admission',
  ttlSeconds: CHECKOUT_ADMISSION_LEASE_SECONDS,
  inProgressTtlSeconds: CHECKOUT_ADMISSION_LEASE_SECONDS,
  retryFailures: true,
  storeResultBody: false,
  forceStorage: 'database',
})

export interface CheckoutAdmissionClaim {
  normalizedKey: string
  storageMethod: AtomicClaimResult['storageMethod']
  claimToken: string
}

/**
 * Resolves the billing reference using the same precedence as Better Auth's
 * Stripe `referenceMiddleware`: an explicit reference wins, otherwise an
 * organization checkout uses the active organization and a personal checkout
 * uses the session user.
 */
export function resolveCheckoutReferenceId(
  body: { referenceId?: unknown; customerType?: unknown },
  sessionUserId: string,
  activeOrganizationId: string | null
): string | null {
  if (body.referenceId) {
    return typeof body.referenceId === 'string' ? body.referenceId : null
  }
  if (body.customerType === 'organization') return activeOrganizationId
  return sessionUserId
}

/**
 * Atomically reserves one in-flight checkout request per billing reference.
 * The claim spans Better Auth's local-row preparation and Stripe Checkout
 * creation, closing the window where two requests could both pass a read-only
 * admission check before either one bound a subscription.
 */
export async function claimCheckoutAdmission(referenceId: string): Promise<CheckoutAdmissionClaim> {
  const claim = await checkoutAdmissionLeases.atomicallyClaim('stripe', referenceId)
  if (!claim.claimed) {
    logger.warn('Blocking concurrent subscription checkout', { referenceId })
    throw new APIError('CONFLICT', {
      message:
        'A subscription checkout is already being started. Please wait a moment and try again.',
    })
  }
  if (!claim.claimToken) {
    throw new Error('Checkout admission claim is missing its fencing token')
  }
  return {
    normalizedKey: claim.normalizedKey,
    storageMethod: claim.storageMethod,
    claimToken: claim.claimToken,
  }
}

/**
 * Releases a checkout admission claim without masking the endpoint result.
 * A failed release is bounded by the claim's short lease and remains visible
 * in logs for operators.
 */
export async function releaseCheckoutAdmission(claim: CheckoutAdmissionClaim): Promise<void> {
  try {
    await checkoutAdmissionLeases.release(
      claim.normalizedKey,
      claim.storageMethod,
      claim.claimToken
    )
  } catch (error) {
    logger.warn('Failed to release checkout admission claim; lease will expire', {
      normalizedKey: claim.normalizedKey,
      error: getErrorMessage(error, 'Unknown error'),
    })
  }
}
