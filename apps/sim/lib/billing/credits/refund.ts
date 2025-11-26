import { db } from '@sim/db'
import { organization, user, userStats } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CreditRefund')

// Minimum balance to refund (avoid processing small refunds)
const MINIMUM_REFUND_AMOUNT = 10

/**
 * Refunds unused prepaid credits when a subscription is cancelled.
 * Only refunds if balance is >= $10 to avoid small refund processing costs.
 *
 * @param subscription - The cancelled subscription
 * @param userId - The user who owns the subscription (for getting Stripe customer ID)
 */
export async function refundUnusedCredits({
  subscription,
  userId,
}: {
  subscription: {
    id: string
    plan: string | null
    referenceId: string
    stripeSubscriptionId: string | null
  }
  userId: string
}): Promise<void> {
  try {
    let balance = 0
    const referenceId = subscription.referenceId
    let referenceType: 'user' | 'organization'

    // Determine where credits are stored based on plan type
    if (subscription.plan === 'team' || subscription.plan === 'enterprise') {
      // Organization credits
      const [org] = await db
        .select({ balance: organization.prepaidCreditsBalance })
        .from(organization)
        .where(eq(organization.id, subscription.referenceId))
        .limit(1)

      balance = Number.parseFloat(org?.balance?.toString() || '0')
      referenceType = 'organization'
    } else {
      // Individual user credits (Pro plan)
      const [stats] = await db
        .select({ balance: userStats.prepaidCreditsBalance })
        .from(userStats)
        .where(eq(userStats.userId, subscription.referenceId))
        .limit(1)

      balance = Number.parseFloat(stats?.balance?.toString() || '0')
      referenceType = 'user'
    }

    if (balance <= 0) {
      logger.info('No credits to refund', { userId, referenceId, referenceType })
      return
    }

    // Only refund if balance meets minimum threshold
    if (balance < MINIMUM_REFUND_AMOUNT) {
      logger.info('Skipping credit refund - balance below minimum threshold', {
        userId,
        referenceId,
        referenceType,
        balance,
        minimumRefund: MINIMUM_REFUND_AMOUNT,
      })
      return
    }

    // Get Stripe customer ID (always from the user, even for org subscriptions)
    const [userRecord] = await db
      .select({ stripeCustomerId: user.stripeCustomerId })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!userRecord?.stripeCustomerId) {
      logger.error('Stripe customer ID not found for refund', { userId, referenceId })
      return
    }

    const stripe = requireStripeClient()
    const roundedBalance = Math.round(balance * 100) / 100 // Round to 2 decimal places

    // Create a refund invoice (negative invoice = credit to customer)
    const invoice = await stripe.invoices.create({
      customer: userRecord.stripeCustomerId,
      collection_method: 'send_invoice',
      description: 'Refund of unused prepaid credits',
      metadata: {
        type: 'credit_refund',
        originalBalance: roundedBalance.toString(),
        referenceId,
        referenceType,
        subscriptionId: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId || '',
      },
    })

    // Add credit line item (negative amount = refund)
    await stripe.invoiceItems.create({
      customer: userRecord.stripeCustomerId,
      invoice: invoice.id,
      amount: -Math.round(roundedBalance * 100), // Negative cents = credit
      currency: 'usd',
      description: `Refund of unused prepaid credits ($${roundedBalance.toFixed(2)})`,
      metadata: {
        type: 'credit_refund',
        originalBalance: roundedBalance.toString(),
      },
    })

    // Finalize and send the credit note invoice
    if (invoice.id) {
      await stripe.invoices.finalizeInvoice(invoice.id)
    }

    logger.info('Created credit refund invoice', {
      userId,
      referenceId,
      referenceType,
      balance: roundedBalance,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
    })

    // Zero out the credit balance
    if (referenceType === 'organization') {
      await db
        .update(organization)
        .set({ prepaidCreditsBalance: '0' })
        .where(eq(organization.id, referenceId))
    } else {
      await db
        .update(userStats)
        .set({ prepaidCreditsBalance: '0' })
        .where(eq(userStats.userId, referenceId))
    }

    logger.info('Successfully refunded unused prepaid credits', {
      userId,
      referenceId,
      referenceType,
      amount: roundedBalance,
      invoiceId: invoice.id,
    })
  } catch (error) {
    logger.error('Error refunding unused credits', {
      userId,
      subscriptionId: subscription.id,
      referenceId: subscription.referenceId,
      error,
    })
    // Don't throw - we don't want to fail the entire subscription cancellation webhook
  }
}
