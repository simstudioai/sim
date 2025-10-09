import { db } from '@sim/db'
import { member, subscription as subscriptionTable, userStats } from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import type Stripe from 'stripe'
import { calculateSubscriptionOverage } from '@/lib/billing/core/billing'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('StripeInvoiceWebhooks')

const OVERAGE_INVOICE_TYPES = new Set<string>([
  'overage_billing',
  'overage_threshold_billing',
  'overage_threshold_billing_org',
])

function parseDecimal(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  return Number.parseFloat(value.toString())
}

/**
 * Get total billed overage for a subscription, handling team vs individual plans
 * For team plans: sums billedOverageThisPeriod across all members
 * For other plans: gets billedOverageThisPeriod for the user
 */
export async function getBilledOverageForSubscription(sub: {
  plan: string | null
  referenceId: string
}): Promise<number> {
  let billedOverage = 0

  if (sub.plan === 'team') {
    const members = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, sub.referenceId))

    const memberIds = members.map((m) => m.userId)

    if (memberIds.length > 0) {
      const memberStatsRows = await db
        .select({
          userId: userStats.userId,
          billedOverageThisPeriod: userStats.billedOverageThisPeriod,
        })
        .from(userStats)
        .where(inArray(userStats.userId, memberIds))

      for (const stats of memberStatsRows) {
        billedOverage += parseDecimal(stats.billedOverageThisPeriod)
      }
    }
  } else {
    const userStatsRecords = await db
      .select({ billedOverageThisPeriod: userStats.billedOverageThisPeriod })
      .from(userStats)
      .where(eq(userStats.userId, sub.referenceId))
      .limit(1)

    if (userStatsRecords.length > 0) {
      billedOverage = parseDecimal(userStatsRecords[0].billedOverageThisPeriod)
    }
  }

  return billedOverage
}

export async function resetUsageForSubscription(sub: { plan: string | null; referenceId: string }) {
  if (sub.plan === 'team' || sub.plan === 'enterprise') {
    const membersRows = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, sub.referenceId))

    for (const m of membersRows) {
      const currentStats = await db
        .select({ current: userStats.currentPeriodCost })
        .from(userStats)
        .where(eq(userStats.userId, m.userId))
        .limit(1)
      if (currentStats.length > 0) {
        const current = currentStats[0].current || '0'
        await db
          .update(userStats)
          .set({
            lastPeriodCost: current,
            currentPeriodCost: '0',
            billedOverageThisPeriod: '0',
          })
          .where(eq(userStats.userId, m.userId))
      }
    }
  } else {
    const currentStats = await db
      .select({
        current: userStats.currentPeriodCost,
        snapshot: userStats.proPeriodCostSnapshot,
      })
      .from(userStats)
      .where(eq(userStats.userId, sub.referenceId))
      .limit(1)
    if (currentStats.length > 0) {
      // For Pro plans, combine current + snapshot for lastPeriodCost, then clear both
      const current = Number.parseFloat(currentStats[0].current?.toString() || '0')
      const snapshot = Number.parseFloat(currentStats[0].snapshot?.toString() || '0')
      const totalLastPeriod = (current + snapshot).toString()

      await db
        .update(userStats)
        .set({
          lastPeriodCost: totalLastPeriod,
          currentPeriodCost: '0',
          proPeriodCostSnapshot: '0', // Clear snapshot at period end
          billedOverageThisPeriod: '0', // Clear threshold billing tracker at period end
        })
        .where(eq(userStats.userId, sub.referenceId))
    }
  }
}

/**
 * Handle invoice payment succeeded webhook
 * We unblock any previously blocked users for this subscription.
 */
export async function handleInvoicePaymentSucceeded(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice

    const subscription = invoice.parent?.subscription_details?.subscription
    const stripeSubscriptionId = typeof subscription === 'string' ? subscription : subscription?.id
    if (!stripeSubscriptionId) {
      logger.info('No subscription found on invoice; skipping payment succeeded handler', {
        invoiceId: invoice.id,
      })
      return
    }
    const records = await db
      .select()
      .from(subscriptionTable)
      .where(eq(subscriptionTable.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1)

    if (records.length === 0) return
    const sub = records[0]

    // Only reset usage here if the tenant was previously blocked; otherwise invoice.created already reset it
    let wasBlocked = false
    if (sub.plan === 'team' || sub.plan === 'enterprise') {
      const membersRows = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, sub.referenceId))
      const memberIds = membersRows.map((m) => m.userId)
      if (memberIds.length > 0) {
        const blockedRows = await db
          .select({ blocked: userStats.billingBlocked })
          .from(userStats)
          .where(inArray(userStats.userId, memberIds))

        wasBlocked = blockedRows.some((row) => !!row.blocked)
      }
    } else {
      const row = await db
        .select({ blocked: userStats.billingBlocked })
        .from(userStats)
        .where(eq(userStats.userId, sub.referenceId))
        .limit(1)
      wasBlocked = row.length > 0 ? !!row[0].blocked : false
    }

    if (sub.plan === 'team' || sub.plan === 'enterprise') {
      const members = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, sub.referenceId))
      const memberIds = members.map((m) => m.userId)

      if (memberIds.length > 0) {
        await db
          .update(userStats)
          .set({ billingBlocked: false })
          .where(inArray(userStats.userId, memberIds))
      }
    } else {
      await db
        .update(userStats)
        .set({ billingBlocked: false })
        .where(eq(userStats.userId, sub.referenceId))
    }

    if (wasBlocked) {
      await resetUsageForSubscription({ plan: sub.plan, referenceId: sub.referenceId })
    }
  } catch (error) {
    logger.error('Failed to handle invoice payment succeeded', { eventId: event.id, error })
    throw error
  }
}

/**
 * Handle invoice payment failed webhook
 * This is triggered when a user's payment fails for any invoice (subscription or overage)
 */
export async function handleInvoicePaymentFailed(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice

    const invoiceType = invoice.metadata?.type
    const isOverageInvoice = !!(invoiceType && OVERAGE_INVOICE_TYPES.has(invoiceType))
    let stripeSubscriptionId: string | undefined

    if (isOverageInvoice) {
      // Overage invoices store subscription ID in metadata
      stripeSubscriptionId = invoice.metadata?.subscriptionId as string | undefined
    } else {
      // Regular subscription invoices have it in parent.subscription_details
      const subscription = invoice.parent?.subscription_details?.subscription
      stripeSubscriptionId = typeof subscription === 'string' ? subscription : subscription?.id
    }

    if (!stripeSubscriptionId) {
      logger.info('No subscription found on invoice; skipping payment failed handler', {
        invoiceId: invoice.id,
        isOverageInvoice,
      })
      return
    }

    const customerId = invoice.customer as string
    const failedAmount = invoice.amount_due / 100 // Convert from cents to dollars
    const billingPeriod = invoice.metadata?.billingPeriod || 'unknown'
    const attemptCount = invoice.attempt_count || 1

    logger.warn('Invoice payment failed', {
      invoiceId: invoice.id,
      customerId,
      failedAmount,
      billingPeriod,
      attemptCount,
      customerEmail: invoice.customer_email,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      isOverageInvoice,
      invoiceType: isOverageInvoice ? 'overage' : 'subscription',
    })

    // Block users after first payment failure
    if (attemptCount >= 1) {
      logger.error('Payment failure - blocking users', {
        invoiceId: invoice.id,
        customerId,
        attemptCount,
        isOverageInvoice,
        stripeSubscriptionId,
      })

      const records = await db
        .select()
        .from(subscriptionTable)
        .where(eq(subscriptionTable.stripeSubscriptionId, stripeSubscriptionId))
        .limit(1)

      if (records.length > 0) {
        const sub = records[0]
        if (sub.plan === 'team' || sub.plan === 'enterprise') {
          const members = await db
            .select({ userId: member.userId })
            .from(member)
            .where(eq(member.organizationId, sub.referenceId))
          const memberIds = members.map((m) => m.userId)

          if (memberIds.length > 0) {
            await db
              .update(userStats)
              .set({ billingBlocked: true })
              .where(inArray(userStats.userId, memberIds))
          }
          logger.info('Blocked team/enterprise members due to payment failure', {
            organizationId: sub.referenceId,
            memberCount: members.length,
            isOverageInvoice,
          })
        } else {
          await db
            .update(userStats)
            .set({ billingBlocked: true })
            .where(eq(userStats.userId, sub.referenceId))
          logger.info('Blocked user due to payment failure', {
            userId: sub.referenceId,
            isOverageInvoice,
          })
        }
      } else {
        logger.warn('Subscription not found in database for failed payment', {
          stripeSubscriptionId,
          invoiceId: invoice.id,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to handle invoice payment failed', {
      eventId: event.id,
      error,
    })
    throw error // Re-throw to signal webhook failure
  }
}

/**
 * Handle base invoice finalized → create a separate overage-only invoice
 * Note: Enterprise plans no longer have overages
 */
export async function handleInvoiceFinalized(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice
    // Only run for subscription renewal invoices (cycle boundary)
    const subscription = invoice.parent?.subscription_details?.subscription
    const stripeSubscriptionId = typeof subscription === 'string' ? subscription : subscription?.id
    if (!stripeSubscriptionId) {
      logger.info('No subscription found on invoice; skipping finalized handler', {
        invoiceId: invoice.id,
      })
      return
    }
    if (invoice.billing_reason && invoice.billing_reason !== 'subscription_cycle') return

    const records = await db
      .select()
      .from(subscriptionTable)
      .where(eq(subscriptionTable.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1)

    if (records.length === 0) return
    const sub = records[0]

    // Enterprise plans have no overages - reset usage and exit
    if (sub.plan === 'enterprise') {
      await resetUsageForSubscription({ plan: sub.plan, referenceId: sub.referenceId })
      return
    }

    const stripe = requireStripeClient()
    const periodEnd =
      invoice.lines?.data?.[0]?.period?.end || invoice.period_end || Math.floor(Date.now() / 1000)
    const billingPeriod = new Date(periodEnd * 1000).toISOString().slice(0, 7)

    // Compute overage (only for team and pro plans), before resetting usage
    const totalOverage = await calculateSubscriptionOverage(sub)

    // Get already-billed overage from threshold billing
    const billedOverage = await getBilledOverageForSubscription(sub)

    // Only bill the remaining unbilled overage
    const remainingOverage = Math.max(0, totalOverage - billedOverage)

    logger.info('Invoice finalized overage calculation', {
      subscriptionId: sub.id,
      totalOverage,
      billedOverage,
      remainingOverage,
      billingPeriod,
    })

    if (remainingOverage > 0) {
      const customerId = String(invoice.customer)
      const cents = Math.round(remainingOverage * 100)
      const itemIdemKey = `overage-item:${customerId}:${stripeSubscriptionId}:${billingPeriod}`
      const invoiceIdemKey = `overage-invoice:${customerId}:${stripeSubscriptionId}:${billingPeriod}`

      // Inherit billing settings from the Stripe subscription/customer for autopay
      const getPaymentMethodId = (
        pm: string | Stripe.PaymentMethod | null | undefined
      ): string | undefined => (typeof pm === 'string' ? pm : pm?.id)

      let collectionMethod: 'charge_automatically' | 'send_invoice' = 'charge_automatically'
      let defaultPaymentMethod: string | undefined
      try {
        const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
        if (stripeSub.collection_method === 'send_invoice') {
          collectionMethod = 'send_invoice'
        }
        const subDpm = getPaymentMethodId(stripeSub.default_payment_method)
        if (subDpm) {
          defaultPaymentMethod = subDpm
        } else if (collectionMethod === 'charge_automatically') {
          const custObj = await stripe.customers.retrieve(customerId)
          if (custObj && !('deleted' in custObj)) {
            const cust = custObj as Stripe.Customer
            const custDpm = getPaymentMethodId(cust.invoice_settings?.default_payment_method)
            if (custDpm) defaultPaymentMethod = custDpm
          }
        }
      } catch (e) {
        logger.error('Failed to retrieve subscription or customer', { error: e })
      }

      // Create a draft invoice first so we can attach the item directly
      const overageInvoice = await stripe.invoices.create(
        {
          customer: customerId,
          collection_method: collectionMethod,
          auto_advance: false,
          ...(defaultPaymentMethod ? { default_payment_method: defaultPaymentMethod } : {}),
          metadata: {
            type: 'overage_billing',
            billingPeriod,
            subscriptionId: stripeSubscriptionId,
          },
        },
        { idempotencyKey: invoiceIdemKey }
      )

      // Attach the item to this invoice
      await stripe.invoiceItems.create(
        {
          customer: customerId,
          invoice: overageInvoice.id,
          amount: cents,
          currency: 'usd',
          description: `Usage Based Overage – ${billingPeriod}`,
          metadata: {
            type: 'overage_billing',
            billingPeriod,
            subscriptionId: stripeSubscriptionId,
          },
        },
        { idempotencyKey: itemIdemKey }
      )

      // Finalize to trigger autopay (if charge_automatically and a PM is present)
      const draftId = overageInvoice.id
      if (typeof draftId !== 'string' || draftId.length === 0) {
        logger.error('Stripe created overage invoice without id; aborting finalize')
      } else {
        const finalized = await stripe.invoices.finalizeInvoice(draftId)
        // Some manual invoices may remain open after finalize; ensure we pay immediately when possible
        if (collectionMethod === 'charge_automatically' && finalized.status === 'open') {
          try {
            const payId = finalized.id
            if (typeof payId !== 'string' || payId.length === 0) {
              logger.error('Finalized invoice missing id')
              throw new Error('Finalized invoice missing id')
            }
            await stripe.invoices.pay(payId, {
              payment_method: defaultPaymentMethod,
            })
          } catch (payError) {
            logger.error('Failed to auto-pay overage invoice', {
              error: payError,
              invoiceId: finalized.id,
            })
          }
        }
      }
    }

    // Finally, reset usage for this subscription after overage handling
    await resetUsageForSubscription({ plan: sub.plan, referenceId: sub.referenceId })
  } catch (error) {
    logger.error('Failed to handle invoice finalized', { error })
    throw error
  }
}
