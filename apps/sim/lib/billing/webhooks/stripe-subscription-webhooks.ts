import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { subscription as subscriptionTable } from '@/db/schema'

const logger = createLogger('StripeSubscriptionWebhooks')

/**
 * Handle customer.subscription.updated webhook
 * This is triggered when a subscription is updated, including when it enters a new billing period
 */
export async function handleSubscriptionUpdated(event: Stripe.Event) {
  try {
    const stripeSubscription = event.data.object as Stripe.Subscription
    const previousAttributes = (event.data as any).previous_attributes || {}

    // Check if subscription exists first
    const existingSubscription = await db
      .select({
        id: subscriptionTable.id,
        periodStart: subscriptionTable.periodStart,
        periodEnd: subscriptionTable.periodEnd,
        status: subscriptionTable.status,
        plan: subscriptionTable.plan,
      })
      .from(subscriptionTable)
      .where(eq(subscriptionTable.stripeSubscriptionId, stripeSubscription.id))
      .limit(1)

    if (existingSubscription.length === 0) {
      logger.warn('No matching subscription found to update', {
        stripeSubscriptionId: stripeSubscription.id,
        eventId: event.id,
      })
      return
    }

    const existing = existingSubscription[0]
    const newPeriodStart = new Date(stripeSubscription.current_period_start * 1000)
    const newPeriodEnd = new Date(stripeSubscription.current_period_end * 1000)

    // Detect if this is a period renewal vs other update
    const isPeriodRenewal =
      existing.periodStart &&
      existing.periodEnd &&
      (newPeriodStart.getTime() !== existing.periodStart.getTime() ||
        newPeriodEnd.getTime() !== existing.periodEnd.getTime())

    // Extract plan from Stripe subscription items
    // Stripe stores the plan/price info in items.data[0].price
    const planId = stripeSubscription.items?.data?.[0]?.price?.id
    let plan = existing.plan // Keep existing plan by default

    // Map Stripe price IDs to our plan names if needed
    // This mapping should match what better-auth sets
    if (planId && stripeSubscription.items?.data?.[0]?.price?.metadata?.plan) {
      plan = stripeSubscription.items.data[0].price.metadata.plan
    }

    // Update our subscription table with the latest data
    await db
      .update(subscriptionTable)
      .set({
        periodStart: newPeriodStart,
        periodEnd: newPeriodEnd,
        status: stripeSubscription.status,
        // Note: We don't update 'plan' here as better-auth manages that mapping
        // The plan field should be updated by better-auth's onSubscriptionUpdate
      })
      .where(eq(subscriptionTable.stripeSubscriptionId, stripeSubscription.id))

    logger.info('Updated subscription', {
      stripeSubscriptionId: stripeSubscription.id,
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
      status: stripeSubscription.status,
      isPeriodRenewal,
      previousAttributes: Object.keys(previousAttributes),
      eventId: event.id,
    })
  } catch (error) {
    logger.error('Failed to handle subscription updated webhook', {
      eventId: event.id,
      error,
    })
    throw error // Re-throw to signal webhook failure
  }
}

/**
 * Handle all subscription-related webhook events
 */
export async function handleSubscriptionWebhook(event: Stripe.Event) {
  switch (event.type) {
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event)
      break
    default:
      logger.info('Unhandled subscription webhook event type', {
        eventType: event.type,
        eventId: event.id,
      })
  }
}
