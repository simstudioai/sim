import { db } from '@sim/db'
import { member, subscription, userStats } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { DEFAULT_OVERAGE_THRESHOLD } from '@/lib/billing/constants'
import { calculateSubscriptionOverage, getPlanPricing } from '@/lib/billing/core/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ThresholdBilling')

const OVERAGE_THRESHOLD = env.OVERAGE_THRESHOLD_DOLLARS || DEFAULT_OVERAGE_THRESHOLD

function parseDecimal(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  return Number.parseFloat(value.toString())
}

async function createAndFinalizeOverageInvoice(
  stripe: ReturnType<typeof requireStripeClient>,
  params: {
    customerId: string
    stripeSubscriptionId: string
    amountCents: number
    description: string
    itemDescription: string
    metadata: Record<string, string>
    idempotencyKey: string
  }
): Promise<string> {
  const getPaymentMethodId = (
    pm: string | Stripe.PaymentMethod | null | undefined
  ): string | undefined => (typeof pm === 'string' ? pm : pm?.id)

  let defaultPaymentMethod: string | undefined
  try {
    const stripeSub = await stripe.subscriptions.retrieve(params.stripeSubscriptionId)
    const subDpm = getPaymentMethodId(stripeSub.default_payment_method)
    if (subDpm) {
      defaultPaymentMethod = subDpm
    } else {
      const custObj = await stripe.customers.retrieve(params.customerId)
      if (custObj && !('deleted' in custObj)) {
        const cust = custObj as Stripe.Customer
        const custDpm = getPaymentMethodId(cust.invoice_settings?.default_payment_method)
        if (custDpm) defaultPaymentMethod = custDpm
      }
    }
  } catch (e) {
    logger.error('Failed to retrieve subscription or customer', { error: e })
  }

  const invoice = await stripe.invoices.create(
    {
      customer: params.customerId,
      collection_method: 'charge_automatically',
      auto_advance: false,
      description: params.description,
      metadata: params.metadata,
      ...(defaultPaymentMethod ? { default_payment_method: defaultPaymentMethod } : {}),
    },
    { idempotencyKey: `${params.idempotencyKey}-invoice` }
  )

  await stripe.invoiceItems.create(
    {
      customer: params.customerId,
      invoice: invoice.id,
      amount: params.amountCents,
      currency: 'usd',
      description: params.itemDescription,
      metadata: params.metadata,
    },
    { idempotencyKey: params.idempotencyKey }
  )

  if (invoice.id) {
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id)

    if (finalized.status === 'open' && finalized.id) {
      try {
        await stripe.invoices.pay(finalized.id, {
          payment_method: defaultPaymentMethod,
        })
      } catch (payError) {
        logger.error('Failed to auto-pay threshold overage invoice', {
          error: payError,
          invoiceId: finalized.id,
        })
      }
    }
  }

  return invoice.id || ''
}

export async function checkAndBillOverageThreshold(userId: string): Promise<void> {
  try {
    const threshold = OVERAGE_THRESHOLD

    await db.transaction(async (tx) => {
      const statsRecords = await tx
        .select()
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .for('update')
        .limit(1)

      if (statsRecords.length === 0) {
        logger.warn('User stats not found for threshold billing', { userId })
        return
      }

      const stats = statsRecords[0]

      const userSubscription = await getHighestPrioritySubscription(userId)

      if (!userSubscription || userSubscription.status !== 'active') {
        logger.debug('No active subscription for threshold billing', { userId })
        return
      }

      if (
        !userSubscription.plan ||
        userSubscription.plan === 'free' ||
        userSubscription.plan === 'enterprise'
      ) {
        return
      }

      const isTeamPlan = userSubscription.plan === 'team'

      if (isTeamPlan && userSubscription.referenceId !== userId) {
        logger.debug('User is team member - skipping individual threshold billing', {
          userId,
          organizationId: userSubscription.referenceId,
        })
        return
      }

      const currentOverage = await calculateSubscriptionOverage({
        id: userSubscription.id,
        plan: userSubscription.plan,
        referenceId: userSubscription.referenceId,
        seats: userSubscription.seats,
      })
      const billedOverageThisPeriod = parseDecimal(stats.billedOverageThisPeriod)
      const unbilledOverage = Math.max(0, currentOverage - billedOverageThisPeriod)

      logger.debug('Threshold billing check', {
        userId,
        plan: userSubscription.plan,
        currentOverage,
        billedOverageThisPeriod,
        unbilledOverage,
        threshold,
      })

      if (unbilledOverage < threshold) {
        return
      }

      const amountToBill = unbilledOverage

      const stripeSubscriptionId = userSubscription.stripeSubscriptionId
      if (!stripeSubscriptionId) {
        logger.error('No Stripe subscription ID found', { userId })
        return
      }

      const stripe = requireStripeClient()
      const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
      const customerId = stripeSubscription.customer as string

      const periodEnd = userSubscription.periodEnd
        ? Math.floor(userSubscription.periodEnd.getTime() / 1000)
        : Math.floor(Date.now() / 1000)
      const billingPeriod = new Date(periodEnd * 1000).toISOString().slice(0, 7)

      const timestamp = Date.now()
      const idempotencyKey = `threshold-overage:${customerId}:${stripeSubscriptionId}:${billingPeriod}:${timestamp}`

      logger.info('Creating threshold overage invoice', {
        userId,
        plan: userSubscription.plan,
        amountToBill,
        billingPeriod,
        idempotencyKey,
      })

      try {
        const cents = Math.round(amountToBill * 100)

        const invoiceId = await createAndFinalizeOverageInvoice(stripe, {
          customerId,
          stripeSubscriptionId,
          amountCents: cents,
          description: `Threshold overage billing – ${billingPeriod}`,
          itemDescription: `Usage overage ($${amountToBill.toFixed(2)})`,
          metadata: {
            type: 'threshold_overage',
            userId,
            subscriptionId: stripeSubscriptionId,
            billingPeriod,
            totalOverageAtTimeOfBilling: currentOverage.toFixed(2),
          },
          idempotencyKey,
        })

        await tx
          .update(userStats)
          .set({
            billedOverageThisPeriod: sql`${userStats.billedOverageThisPeriod} + ${amountToBill}`,
          })
          .where(eq(userStats.userId, userId))

        logger.info('Successfully created and finalized threshold overage invoice', {
          userId,
          amountBilled: amountToBill,
          invoiceId,
          newBilledTotal: billedOverageThisPeriod + amountToBill,
        })
      } catch (stripeError) {
        logger.error('Failed to create threshold overage invoice item', {
          userId,
          amountToBill,
          error: stripeError,
        })
      }
    })
  } catch (error) {
    logger.error('Error in threshold billing check', {
      userId,
      error,
    })
  }
}

export async function checkAndBillOrganizationOverageThreshold(
  organizationId: string
): Promise<void> {
  try {
    const threshold = OVERAGE_THRESHOLD

    const orgSubscriptions = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, organizationId), eq(subscription.status, 'active')))
      .limit(1)

    if (orgSubscriptions.length === 0) {
      logger.debug('No active subscription for organization', { organizationId })
      return
    }

    const orgSubscription = orgSubscriptions[0]

    if (orgSubscription.plan !== 'team') {
      return
    }

    const members = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, organizationId))

    if (members.length === 0) {
      return
    }

    await db.transaction(async (tx) => {
      let totalTeamUsage = 0
      let totalBilledOverage = 0

      for (const m of members) {
        const memberStats = await tx
          .select({
            currentPeriodCost: userStats.currentPeriodCost,
            billedOverageThisPeriod: userStats.billedOverageThisPeriod,
          })
          .from(userStats)
          .where(eq(userStats.userId, m.userId))
          .limit(1)

        if (memberStats.length > 0) {
          totalTeamUsage += parseDecimal(memberStats[0].currentPeriodCost)
          totalBilledOverage += parseDecimal(memberStats[0].billedOverageThisPeriod)
        }
      }

      const { basePrice: basePricePerSeat } = getPlanPricing(orgSubscription.plan)
      const basePrice = basePricePerSeat * (orgSubscription.seats || 1)
      const currentOverage = Math.max(0, totalTeamUsage - basePrice)
      const unbilledOverage = Math.max(0, currentOverage - totalBilledOverage)

      logger.debug('Organization threshold billing check', {
        organizationId,
        totalTeamUsage,
        basePrice,
        currentOverage,
        totalBilledOverage,
        unbilledOverage,
        threshold,
      })

      if (unbilledOverage < threshold) {
        return
      }

      const amountToBill = unbilledOverage

      const stripeSubscriptionId = orgSubscription.stripeSubscriptionId
      if (!stripeSubscriptionId) {
        logger.error('No Stripe subscription ID for organization', { organizationId })
        return
      }

      const stripe = requireStripeClient()
      const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
      const customerId = stripeSubscription.customer as string

      const periodEnd = orgSubscription.periodEnd
        ? Math.floor(orgSubscription.periodEnd.getTime() / 1000)
        : Math.floor(Date.now() / 1000)
      const billingPeriod = new Date(periodEnd * 1000).toISOString().slice(0, 7)
      const timestamp = Date.now()

      const idempotencyKey = `threshold-overage-org:${customerId}:${stripeSubscriptionId}:${billingPeriod}:${timestamp}`

      logger.info('Creating organization threshold overage invoice', {
        organizationId,
        amountToBill,
        billingPeriod,
      })

      try {
        const cents = Math.round(amountToBill * 100)

        const invoiceId = await createAndFinalizeOverageInvoice(stripe, {
          customerId,
          stripeSubscriptionId,
          amountCents: cents,
          description: `Team threshold overage billing – ${billingPeriod}`,
          itemDescription: `Team usage overage ($${amountToBill.toFixed(2)})`,
          metadata: {
            type: 'threshold_overage_organization',
            organizationId,
            subscriptionId: stripeSubscriptionId,
            billingPeriod,
            totalOverageAtTimeOfBilling: currentOverage.toFixed(2),
          },
          idempotencyKey,
        })

        if (members.length > 0) {
          await tx
            .update(userStats)
            .set({
              billedOverageThisPeriod: sql`${userStats.billedOverageThisPeriod} + ${amountToBill}`,
            })
            .where(eq(userStats.userId, members[0].userId))
        }

        logger.info('Successfully created and finalized organization threshold overage invoice', {
          organizationId,
          amountBilled: amountToBill,
          invoiceId,
        })
      } catch (stripeError) {
        logger.error('Failed to create organization threshold overage invoice', {
          organizationId,
          amountToBill,
          error: stripeError,
        })
      }
    })
  } catch (error) {
    logger.error('Error in organization threshold billing', {
      organizationId,
      error,
    })
  }
}
