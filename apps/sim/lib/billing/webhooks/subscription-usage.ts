import { db } from '@sim/db'
import { subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'
import { SubscriptionReferenceNotFoundError } from '@/lib/billing/subscriptions/errors'

const logger = createLogger('SubscriptionUsageWebhook')

/**
 * Reconciles usage limits through the Stripe plugin's retryable onEvent hook.
 * Read the persisted reference after subscription callbacks may have moved it
 * to an organization. Callback exceptions alone are swallowed by the plugin.
 * A subscription whose reference no longer resolves is acknowledged, since no
 * redelivery can sync a billing pool that does not exist.
 */
export async function handleSubscriptionUsageUpdate(event: Stripe.Event): Promise<void> {
  if (event.type !== 'customer.subscription.updated') return

  const [persistedSubscription] = await db
    .select({
      id: subscription.id,
      referenceId: subscription.referenceId,
      plan: subscription.plan,
      status: subscription.status,
      seats: subscription.seats,
    })
    .from(subscription)
    .where(eq(subscription.stripeSubscriptionId, event.data.object.id))
    .limit(1)

  if (!persistedSubscription) return

  try {
    await syncSubscriptionUsageLimits(persistedSubscription)
  } catch (error) {
    if (!(error instanceof SubscriptionReferenceNotFoundError)) throw error
    logger.error('Skipping usage-limit sync for a subscription whose reference no longer exists', {
      subscriptionId: persistedSubscription.id,
      stripeSubscriptionId: event.data.object.id,
      eventType: event.type,
      referenceId: persistedSubscription.referenceId,
    })
  }
}
