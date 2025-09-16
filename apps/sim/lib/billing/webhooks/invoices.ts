import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { getUserUsageData } from '@/lib/billing/core/usage'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { member, subscription as subscriptionTable, userStats } from '@/db/schema'

const logger = createLogger('StripeInvoiceWebhooks')

async function resetUsageForSubscription(sub: { plan: string | null; referenceId: string }) {
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
          .set({ lastPeriodCost: current, currentPeriodCost: '0' })
          .where(eq(userStats.userId, m.userId))
      }
    }
  } else {
    const currentStats = await db
      .select({ current: userStats.currentPeriodCost })
      .from(userStats)
      .where(eq(userStats.userId, sub.referenceId))
      .limit(1)
    if (currentStats.length > 0) {
      const current = currentStats[0].current || '0'
      await db
        .update(userStats)
        .set({ lastPeriodCost: current, currentPeriodCost: '0' })
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
      for (const m of membersRows) {
        const row = await db
          .select({ blocked: userStats.billingBlocked })
          .from(userStats)
          .where(eq(userStats.userId, m.userId))
          .limit(1)
        if (row.length > 0 && row[0].blocked) {
          wasBlocked = true
          break
        }
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
      for (const m of members) {
        await db
          .update(userStats)
          .set({ billingBlocked: false })
          .where(eq(userStats.userId, m.userId))
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
 * This is triggered when a user's payment fails for a usage billing invoice
 */
export async function handleInvoicePaymentFailed(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice

    // Check if this is an overage billing invoice
    if (invoice.metadata?.type !== 'overage_billing') {
      logger.info('Ignoring non-overage billing invoice payment failure', { invoiceId: invoice.id })
      return
    }

    const customerId = invoice.customer as string
    const failedAmount = invoice.amount_due / 100 // Convert from cents to dollars
    const billingPeriod = invoice.metadata?.billingPeriod || 'unknown'
    const attemptCount = invoice.attempt_count || 1

    logger.warn('Overage billing invoice payment failed', {
      invoiceId: invoice.id,
      customerId,
      failedAmount,
      billingPeriod,
      attemptCount,
      customerEmail: invoice.customer_email,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
    })

    // Implement dunning management logic here
    // For example: suspend service after multiple failures, notify admins, etc.
    if (attemptCount >= 1) {
      logger.error('Multiple payment failures for overage billing', {
        invoiceId: invoice.id,
        customerId,
        attemptCount,
      })
      // Block all users under this customer (org members or individual)
      // Overage invoices are manual invoices without parent.subscription_details
      // We store the subscription ID in metadata when creating them
      const stripeSubscriptionId = invoice.metadata?.subscriptionId as string | undefined
      if (stripeSubscriptionId) {
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
            for (const m of members) {
              await db
                .update(userStats)
                .set({ billingBlocked: true })
                .where(eq(userStats.userId, m.userId))
            }
          } else {
            await db
              .update(userStats)
              .set({ billingBlocked: true })
              .where(eq(userStats.userId, sub.referenceId))
          }
        }
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
    let totalOverage = 0
    if (sub.plan === 'team') {
      const members = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, sub.referenceId))

      let totalTeamUsage = 0
      for (const m of members) {
        const usage = await getUserUsageData(m.userId)
        totalTeamUsage += usage.currentUsage
      }

      const { getPlanPricing } = await import('@/lib/billing/core/billing')
      const { basePrice } = getPlanPricing(sub.plan)
      const baseSubscriptionAmount = (sub.seats || 1) * basePrice
      totalOverage = Math.max(0, totalTeamUsage - baseSubscriptionAmount)
    } else {
      const usage = await getUserUsageData(sub.referenceId)
      const { getPlanPricing } = await import('@/lib/billing/core/billing')
      const { basePrice } = getPlanPricing(sub.plan)
      totalOverage = Math.max(0, usage.currentUsage - basePrice)
    }

    if (totalOverage > 0) {
      const customerId = String(invoice.customer)
      const cents = Math.round(totalOverage * 100)
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
