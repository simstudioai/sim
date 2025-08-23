import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import {
  resetOrganizationBillingPeriod,
  resetUserBillingPeriod,
} from '@/lib/billing/core/billing-periods'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { subscription as subscriptionTable } from '@/db/schema'

const logger = createLogger('StripeInvoiceWebhooks')

/**
 * Handle invoice payment succeeded webhook
 * This is triggered when a user successfully pays a usage billing invoice
 */
export async function handleInvoicePaymentSucceeded(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice

    // Case 1: Overage invoices (metadata.type === 'overage_billing')
    if (invoice.metadata?.type === 'overage_billing') {
      const customerId = invoice.customer as string
      const chargedAmount = invoice.amount_paid / 100
      const billingPeriod = invoice.metadata?.billingPeriod || 'unknown'

      logger.info('Overage billing invoice payment succeeded', {
        invoiceId: invoice.id,
        customerId,
        chargedAmount,
        billingPeriod,
        customerEmail: invoice.customer_email,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
      })

      return
    }

    // Case 2: Subscription renewal invoice paid (primary period rollover)
    // Only reset on successful payment to avoid granting a new period while in dunning
    if (invoice.subscription) {
      // Filter to subscription-cycle renewals; ignore updates/off-cycle charges
      const reason = invoice.billing_reason
      const isCycle = reason === 'subscription_cycle'
      if (!isCycle) {
        logger.info('Ignoring non-cycle subscription invoice on payment_succeeded', {
          invoiceId: invoice.id,
          billingReason: reason,
        })
        return
      }

      const stripeSubscriptionId = String(invoice.subscription)
      const records = await db
        .select()
        .from(subscriptionTable)
        .where(eq(subscriptionTable.stripeSubscriptionId, stripeSubscriptionId))
        .limit(1)

      if (records.length === 0) {
        logger.warn('No matching internal subscription for paid Stripe invoice', {
          invoiceId: invoice.id,
          stripeSubscriptionId,
        })
        return
      }

      const sub = records[0]

      if (sub.plan === 'team' || sub.plan === 'enterprise') {
        await resetOrganizationBillingPeriod(sub.referenceId)
        logger.info('Reset organization billing period on subscription invoice payment', {
          invoiceId: invoice.id,
          organizationId: sub.referenceId,
          plan: sub.plan,
        })
      } else {
        await resetUserBillingPeriod(sub.referenceId)
        logger.info('Reset user billing period on subscription invoice payment', {
          invoiceId: invoice.id,
          userId: sub.referenceId,
          plan: sub.plan,
        })
      }

      return
    }

    logger.info('Ignoring non-subscription invoice payment', { invoiceId: invoice.id })
  } catch (error) {
    logger.error('Failed to handle invoice payment succeeded', {
      eventId: event.id,
      error,
    })
    throw error // Re-throw to signal webhook failure
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
    if (attemptCount >= 3) {
      logger.error('Multiple payment failures for overage billing', {
        invoiceId: invoice.id,
        customerId,
        attemptCount,
      })

      // Could implement service suspension here
      // await suspendUserService(customerId)
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
 * Handle invoice finalized webhook
 * This is triggered when a usage billing invoice is finalized and ready for payment
 */
export async function handleInvoiceFinalized(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice
    // Do not reset usage on finalized; wait for payment success to avoid granting new period during dunning
    if (invoice.metadata?.type === 'overage_billing') {
      const customerId = invoice.customer as string
      const invoiceAmount = invoice.amount_due / 100
      const billingPeriod = invoice.metadata?.billingPeriod || 'unknown'
      logger.info('Overage billing invoice finalized', {
        invoiceId: invoice.id,
        customerId,
        invoiceAmount,
        billingPeriod,
      })
      return
    }
    logger.info('Ignoring subscription invoice finalization; will act on payment_succeeded', {
      invoiceId: invoice.id,
      billingReason: invoice.billing_reason,
    })
  } catch (error) {
    logger.error('Failed to handle invoice finalized', {
      eventId: event.id,
      error,
    })
    throw error // Re-throw to signal webhook failure
  }
}

/**
 * Main webhook handler for all invoice-related events
 */
export async function handleInvoiceWebhook(event: Stripe.Event) {
  switch (event.type) {
    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(event)
      break

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event)
      break

    case 'invoice.finalized':
      await handleInvoiceFinalized(event)
      break

    default:
      logger.info('Unhandled invoice webhook event', { eventType: event.type })
  }
}
