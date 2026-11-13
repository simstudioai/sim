import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getAwsMarketplaceProducts } from '@/lib/billing/aws-marketplace/config'
import {
  enqueueStripeCancellationForMarketplace,
  findSubscriptionReference,
  listLicensesBillingReference,
  lockSelfServeStripeSubscription,
  organizationExists,
} from '@/lib/billing/aws-marketplace/repository'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'

const logger = createLogger('AwsMarketplaceStripeFence')

/**
 * Cancels a Stripe subscription that has just bound to a customer AWS Marketplace already bills,
 * so the customer is never charged twice. Returns true when the subscription is cancelled, and the
 * caller then skips the paid-plan setup.
 *
 * The checkout guard refuses such a checkout before it starts, and linking a license refuses an
 * organization already bound to Stripe, but a hosted checkout left open across a link passes both:
 * no lock can span it. This closes that window once Stripe binds the subscription. It takes the
 * organization mutation lock the link holds from its Stripe check to its commit, so it runs either
 * before that check (which then sees the bound subscription and refuses) or after the link commits
 * (and this sees the license).
 *
 * Stripe stays the authority on entitlement: the cancellation is queued, and its verified deletion
 * webhook ends the subscription row. The team is told to refund the charge, which a cancellation
 * only credits to the Stripe balance.
 */
export async function cancelStripeSubscriptionBilledThroughMarketplace(
  subscriptionId: string
): Promise<boolean> {
  const products = getAwsMarketplaceProducts()
  if (products.size === 0) return false

  const cancelled = await db.transaction(async (tx) => {
    const referenceId = await findSubscriptionReference(tx, subscriptionId)
    if (!referenceId) return null
    // Lock order for a subscription's billing writers: organization mutation lock, then the row.
    const organizationId = (await organizationExists(tx, referenceId)) ? referenceId : null
    if (organizationId) await acquireOrganizationMutationLock(tx, organizationId)
    const bound = await lockSelfServeStripeSubscription(tx, subscriptionId)
    if (!bound) return null
    if (bound.referenceId !== referenceId) {
      throw new Error('Subscription changed billing reference while checking AWS Marketplace')
    }
    const licenseIds = await listLicensesBillingReference(tx, products, bound.referenceId)
    if (licenseIds.length === 0) return null
    const queued = await enqueueStripeCancellationForMarketplace(tx, {
      subscriptionId: bound.id,
      stripeSubscriptionId: bound.stripeSubscriptionId,
      organizationId,
      licenseIds,
    })
    return { ...bound, organizationId, licenseIds, queued }
  })
  if (!cancelled) return false

  if (cancelled.queued) {
    logger.error('Cancelled a Stripe subscription for a customer AWS Marketplace already bills', {
      subscriptionId: cancelled.id,
      referenceId: cancelled.referenceId,
      plan: cancelled.plan,
      licenseIds: cancelled.licenseIds,
    })
    recordAudit({
      actorId: null,
      actorName: 'AWS Marketplace billing',
      action: AuditAction.SUBSCRIPTION_CANCELLED,
      resourceType: AuditResourceType.SUBSCRIPTION,
      resourceId: cancelled.id,
      description:
        'Cancelled a Stripe subscription immediately because AWS Marketplace already bills this customer',
      metadata: {
        referenceId: cancelled.referenceId,
        organizationId: cancelled.organizationId,
        plan: cancelled.plan,
        awsMarketplaceLicenseIds: cancelled.licenseIds,
      },
    })
  }
  return true
}
