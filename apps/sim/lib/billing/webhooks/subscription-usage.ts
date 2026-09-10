import { db } from '@sim/db'
import { subscription } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { syncSubscriptionUsageLimits } from '@/lib/billing/organization'

/**
 * Reconciles usage limits through the Stripe plugin's retryable onEvent hook.
 * Read the persisted reference after subscription callbacks may have moved it
 * to an organization. Callback exceptions alone are swallowed by the plugin.
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

  await syncSubscriptionUsageLimits(persistedSubscription)
}
