import { db } from '@sim/db'
import { member, organization, subscription } from '@sim/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import { calculateSubscriptionOverage } from '@/lib/billing/core/billing'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { restoreUserProSubscription } from '@/lib/billing/organizations/membership'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import {
  getBilledOverageForSubscription,
  resetUsageForSubscription,
} from '@/lib/billing/webhooks/invoices'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('StripeSubscriptionWebhooks')

/**
 * Restore personal Pro subscriptions for all members of an organization
 * when the team/enterprise subscription ends.
 */
async function restoreMemberProSubscriptions(organizationId: string): Promise<number> {
  let restoredCount = 0

  try {
    const members = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, organizationId))

    for (const m of members) {
      const result = await restoreUserProSubscription(m.userId)
      if (result.restored) {
        restoredCount++
      }
    }

    if (restoredCount > 0) {
      logger.info('Restored Pro subscriptions for team members', {
        organizationId,
        restoredCount,
        totalMembers: members.length,
      })
    }
  } catch (error) {
    logger.error('Failed to restore member Pro subscriptions', {
      organizationId,
      error,
    })
  }

  return restoredCount
}

/**
 * Handle new subscription creation - reset usage if transitioning from free to paid
 */
export async function handleSubscriptionCreated(subscriptionData: {
  id: string
  referenceId: string
  plan: string | null
  status: string
}) {
  try {
    const otherActiveSubscriptions = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, subscriptionData.referenceId),
          eq(subscription.status, 'active'),
          ne(subscription.id, subscriptionData.id) // Exclude current subscription
        )
      )

    const wasFreePreviously = otherActiveSubscriptions.length === 0
    const isPaidPlan =
      subscriptionData.plan === 'pro' ||
      subscriptionData.plan === 'team' ||
      subscriptionData.plan === 'enterprise'

    if (wasFreePreviously && isPaidPlan) {
      logger.info('Detected free -> paid transition, resetting usage', {
        subscriptionId: subscriptionData.id,
        referenceId: subscriptionData.referenceId,
        plan: subscriptionData.plan,
      })

      await resetUsageForSubscription({
        plan: subscriptionData.plan,
        referenceId: subscriptionData.referenceId,
      })

      logger.info('Successfully reset usage for free -> paid transition', {
        subscriptionId: subscriptionData.id,
        referenceId: subscriptionData.referenceId,
        plan: subscriptionData.plan,
      })
    } else {
      logger.info('No usage reset needed', {
        subscriptionId: subscriptionData.id,
        referenceId: subscriptionData.referenceId,
        plan: subscriptionData.plan,
        wasFreePreviously,
        isPaidPlan,
        otherActiveSubscriptionsCount: otherActiveSubscriptions.length,
      })
    }
  } catch (error) {
    logger.error('Failed to handle subscription creation usage reset', {
      subscriptionId: subscriptionData.id,
      referenceId: subscriptionData.referenceId,
      error,
    })
    throw error
  }
}

/**
 * Handle subscription deletion/cancellation - bill for final period overages
 * This fires when a subscription reaches its cancel_at_period_end date or is cancelled immediately
 */
export async function handleSubscriptionDeleted(subscription: {
  id: string
  plan: string | null
  referenceId: string
  stripeSubscriptionId: string | null
  seats?: number | null
}) {
  try {
    const stripeSubscriptionId = subscription.stripeSubscriptionId || ''

    logger.info('Processing subscription deletion', {
      stripeSubscriptionId,
      subscriptionId: subscription.id,
    })

    // Calculate overage for the final billing period
    const totalOverage = await calculateSubscriptionOverage(subscription)
    const stripe = requireStripeClient()

    // Enterprise plans have no overages - reset usage, restore Pro, sync limits, delete org
    if (subscription.plan === 'enterprise') {
      // Get member userIds before any changes (needed for limit syncing after org deletion)
      const memberUserIds = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, subscription.referenceId))

      await resetUsageForSubscription({
        plan: subscription.plan,
        referenceId: subscription.referenceId,
      })
      const restoredProCount = await restoreMemberProSubscriptions(subscription.referenceId)

      await db.delete(organization).where(eq(organization.id, subscription.referenceId))

      // Sync usage limits for former members (now free or Pro tier)
      for (const m of memberUserIds) {
        await syncUsageLimitsFromSubscription(m.userId)
      }

      logger.info('Successfully processed enterprise subscription cancellation', {
        subscriptionId: subscription.id,
        stripeSubscriptionId,
        restoredProCount,
        organizationDeleted: true,
        membersSynced: memberUserIds.length,
      })
      return
    }

    // Get already-billed overage from threshold billing
    const billedOverage = await getBilledOverageForSubscription(subscription)

    // Only bill the remaining unbilled overage
    const remainingOverage = Math.max(0, totalOverage - billedOverage)

    logger.info('Subscription deleted overage calculation', {
      subscriptionId: subscription.id,
      totalOverage,
      billedOverage,
      remainingOverage,
    })

    // Create final overage invoice if needed
    if (remainingOverage > 0 && stripeSubscriptionId) {
      const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
      const customerId = stripeSubscription.customer as string
      const cents = Math.round(remainingOverage * 100)

      // Use the subscription end date for the billing period
      const endedAt = stripeSubscription.ended_at || Math.floor(Date.now() / 1000)
      const billingPeriod = new Date(endedAt * 1000).toISOString().slice(0, 7)

      const itemIdemKey = `final-overage-item:${customerId}:${stripeSubscriptionId}:${billingPeriod}`
      const invoiceIdemKey = `final-overage-invoice:${customerId}:${stripeSubscriptionId}:${billingPeriod}`

      try {
        // Create a one-time invoice for the final overage
        const overageInvoice = await stripe.invoices.create(
          {
            customer: customerId,
            collection_method: 'charge_automatically',
            auto_advance: true, // Auto-finalize and attempt payment
            description: `Final overage charges for ${subscription.plan} subscription (${billingPeriod})`,
            metadata: {
              type: 'final_overage_billing',
              billingPeriod,
              subscriptionId: stripeSubscriptionId,
              cancelledAt: stripeSubscription.canceled_at?.toString() || '',
            },
          },
          { idempotencyKey: invoiceIdemKey }
        )

        // Add the overage line item
        await stripe.invoiceItems.create(
          {
            customer: customerId,
            invoice: overageInvoice.id,
            amount: cents,
            currency: 'usd',
            description: `Usage overage for ${subscription.plan} plan (Final billing period)`,
            metadata: {
              type: 'final_usage_overage',
              usage: remainingOverage.toFixed(2),
              totalOverage: totalOverage.toFixed(2),
              billedOverage: billedOverage.toFixed(2),
              billingPeriod,
            },
          },
          { idempotencyKey: itemIdemKey }
        )

        // Finalize the invoice (this will trigger payment collection)
        if (overageInvoice.id) {
          await stripe.invoices.finalizeInvoice(overageInvoice.id)
        }

        logger.info('Created final overage invoice for cancelled subscription', {
          subscriptionId: subscription.id,
          stripeSubscriptionId,
          invoiceId: overageInvoice.id,
          totalOverage,
          billedOverage,
          remainingOverage,
          cents,
          billingPeriod,
        })
      } catch (invoiceError) {
        logger.error('Failed to create final overage invoice', {
          subscriptionId: subscription.id,
          stripeSubscriptionId,
          totalOverage,
          billedOverage,
          remainingOverage,
          error: invoiceError,
        })
        // Don't throw - we don't want to fail the webhook
      }
    } else {
      logger.info('No overage to bill for cancelled subscription', {
        subscriptionId: subscription.id,
        plan: subscription.plan,
      })
    }

    // Reset usage after billing
    await resetUsageForSubscription({
      plan: subscription.plan,
      referenceId: subscription.referenceId,
    })

    // For team: restore member Pro subscriptions, sync limits, delete organization
    let restoredProCount = 0
    let organizationDeleted = false
    let membersSynced = 0
    if (subscription.plan === 'team') {
      // Get member userIds before deletion (needed for limit syncing)
      const memberUserIds = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, subscription.referenceId))

      restoredProCount = await restoreMemberProSubscriptions(subscription.referenceId)

      await db.delete(organization).where(eq(organization.id, subscription.referenceId))
      organizationDeleted = true

      // Sync usage limits for former members (now free or Pro tier)
      for (const m of memberUserIds) {
        await syncUsageLimitsFromSubscription(m.userId)
      }
      membersSynced = memberUserIds.length
    }

    // Note: better-auth's Stripe plugin already updates status to 'canceled' before calling this handler
    // We handle overage billing, usage reset, Pro restoration, limit syncing, and org cleanup

    logger.info('Successfully processed subscription cancellation', {
      subscriptionId: subscription.id,
      stripeSubscriptionId,
      totalOverage,
      restoredProCount,
      organizationDeleted,
      membersSynced,
    })
  } catch (error) {
    logger.error('Failed to handle subscription deletion', {
      subscriptionId: subscription.id,
      stripeSubscriptionId: subscription.stripeSubscriptionId || '',
      error,
    })
    throw error // Re-throw to signal webhook failure for retry
  }
}
