import { db } from '@sim/db'
import { organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getPlanPricing } from '@/lib/billing/core/billing'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { canPurchaseCredits } from '@/lib/billing/credits/balance'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getCustomerId, resolveDefaultPaymentMethod } from '@/lib/billing/stripe-payment-method'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'

const logger = createLogger('CreditPurchase')

/**
 * Sets usage limit to planBase + creditBalance.
 * This ensures users can use their plan's included amount plus any prepaid credits.
 */
export async function setUsageLimitForCredits(
  entityType: 'user' | 'organization',
  entityId: string,
  plan: string,
  seats: number | null,
  creditBalance: number
): Promise<void> {
  try {
    const { basePrice } = getPlanPricing(plan)

    const seatCount = seats || 1
    const planBase =
      entityType === 'organization' ? Number(basePrice) * seatCount : Number(basePrice)
    const creditBalanceNum = Number(creditBalance)
    const newLimit = planBase + creditBalanceNum

    if (entityType === 'organization') {
      const orgRows = await db
        .select({ orgUsageLimit: organization.orgUsageLimit })
        .from(organization)
        .where(eq(organization.id, entityId))
        .limit(1)

      const currentLimit = orgRows.length > 0 ? toNumber(toDecimal(orgRows[0].orgUsageLimit)) : 0

      if (newLimit > currentLimit) {
        await db
          .update(organization)
          .set({ orgUsageLimit: newLimit.toString() })
          .where(eq(organization.id, entityId))

        logger.info('Set org usage limit to planBase + credits', {
          organizationId: entityId,
          plan,
          seats,
          planBase,
          creditBalance,
          previousLimit: currentLimit,
          newLimit,
        })
      }
    } else {
      const userStatsRows = await db
        .select({ currentUsageLimit: userStats.currentUsageLimit })
        .from(userStats)
        .where(eq(userStats.userId, entityId))
        .limit(1)

      const currentLimit =
        userStatsRows.length > 0 ? toNumber(toDecimal(userStatsRows[0].currentUsageLimit)) : 0

      if (newLimit > currentLimit) {
        await db
          .update(userStats)
          .set({ currentUsageLimit: newLimit.toString() })
          .where(eq(userStats.userId, entityId))

        logger.info('Set user usage limit to planBase + credits', {
          userId: entityId,
          plan,
          planBase,
          creditBalance,
          previousLimit: currentLimit,
          newLimit,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to set usage limit for credits', { entityType, entityId, error })
  }
}

export interface PurchaseCreditsParams {
  userId: string
  amountDollars: number
  requestId: string
}

export interface PurchaseResult {
  success: boolean
  error?: string
}

export async function purchaseCredits(params: PurchaseCreditsParams): Promise<PurchaseResult> {
  const { userId, amountDollars, requestId } = params

  if (amountDollars < 10 || amountDollars > 1000) {
    return { success: false, error: 'Amount must be between $10 and $1000' }
  }

  const canPurchase = await canPurchaseCredits(userId)
  if (!canPurchase) {
    return { success: false, error: 'Only Pro and Team users can purchase credits' }
  }

  const subscription = await getHighestPrioritySubscription(userId)
  if (!subscription || !subscription.stripeSubscriptionId) {
    return { success: false, error: 'No active subscription found' }
  }

  // Enterprise users must contact support
  if (isEnterprise(subscription.plan)) {
    return { success: false, error: 'Enterprise users must contact support to purchase credits' }
  }

  let entityType: 'user' | 'organization' = 'user'
  let entityId = userId

  // Org-scoped subs route credit purchases to the organization and must be authorized
  // by an org owner/admin. We've already rejected enterprise above.
  if (isOrgScopedSubscription(subscription, userId)) {
    const isAdmin = await isOrganizationOwnerOrAdmin(userId, subscription.referenceId)
    if (!isAdmin) {
      return { success: false, error: 'Only organization owners and admins can purchase credits' }
    }
    entityType = 'organization'
    entityId = subscription.referenceId
  }

  try {
    const stripe = requireStripeClient()

    const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
    const customerId = getCustomerId(stripeSub.customer)
    if (!customerId) {
      return { success: false, error: 'Subscription missing customer' }
    }

    const { paymentMethodId: defaultPaymentMethod } = await resolveDefaultPaymentMethod(
      stripe,
      subscription.stripeSubscriptionId,
      customerId
    )

    if (!defaultPaymentMethod) {
      return {
        success: false,
        error: 'No payment method on file. Please update your billing info.',
      }
    }

    const amountCents = Math.round(amountDollars * 100)
    const idempotencyKey = `credit-purchase:${requestId}`

    const creditMetadata = {
      type: 'credit_purchase',
      entityType,
      entityId,
      amountDollars: amountDollars.toString(),
      purchasedBy: userId,
    }

    // Create invoice
    const invoice = await stripe.invoices.create(
      {
        customer: customerId,
        collection_method: 'charge_automatically',
        auto_advance: false,
        description: `Credit purchase - $${amountDollars}`,
        metadata: creditMetadata,
        default_payment_method: defaultPaymentMethod,
      },
      { idempotencyKey: `${idempotencyKey}-invoice` }
    )

    // Add line item
    await stripe.invoiceItems.create(
      {
        customer: customerId,
        invoice: invoice.id,
        amount: amountCents,
        currency: 'usd',
        description: `Prepaid credits ($${amountDollars})`,
        metadata: creditMetadata,
      },
      { idempotencyKey: `${idempotencyKey}-item` }
    )

    // Finalize and pay
    if (!invoice.id) {
      return { success: false, error: 'Failed to create invoice' }
    }

    const finalized = await stripe.invoices.finalizeInvoice(
      invoice.id,
      {},
      { idempotencyKey: `${idempotencyKey}-finalize` }
    )

    if (finalized.status === 'open' && finalized.id) {
      await stripe.invoices.pay(
        finalized.id,
        { payment_method: defaultPaymentMethod },
        { idempotencyKey: `${idempotencyKey}-pay` }
      )
    }

    logger.info('Credit purchase invoice created and paid', {
      invoiceId: invoice.id,
      entityType,
      entityId,
      amountDollars,
      purchasedBy: userId,
    })

    return { success: true }
  } catch (error) {
    logger.error('Failed to purchase credits', { error, userId, amountDollars })
    const message = error instanceof Error ? error.message : 'Failed to process payment'
    return { success: false, error: message }
  }
}
