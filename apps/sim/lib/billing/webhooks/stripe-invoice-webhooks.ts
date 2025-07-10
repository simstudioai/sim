import type Stripe from 'stripe'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('StripeInvoiceWebhooks')

/**
 * Handle invoice payment succeeded webhook
 * This is triggered when a user successfully pays a usage billing invoice
 */
export async function handleInvoicePaymentSucceeded(event: Stripe.Event) {
  try {
    const invoice = event.data.object as Stripe.Invoice

    // Check if this is an overage billing invoice
    if (invoice.metadata?.type !== 'overage_billing') {
      logger.info('Ignoring non-overage billing invoice', { invoiceId: invoice.id })
      return
    }

    const customerId = invoice.customer as string
    const chargedAmount = invoice.amount_paid / 100 // Convert from cents to dollars
    const billingPeriod = invoice.metadata?.billingPeriod || 'unknown'

    logger.info('Overage billing invoice payment succeeded', {
      invoiceId: invoice.id,
      customerId,
      chargedAmount,
      billingPeriod,
      customerEmail: invoice.customer_email,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
    })

    // Additional payment success logic can be added here
    // For example: update internal billing status, trigger analytics events, etc.
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

    // Check if this is an overage billing invoice
    if (invoice.metadata?.type !== 'overage_billing') {
      logger.info('Ignoring non-overage billing invoice finalization', { invoiceId: invoice.id })
      return
    }

    const customerId = invoice.customer as string
    const invoiceAmount = invoice.amount_due / 100 // Convert from cents to dollars
    const billingPeriod = invoice.metadata?.billingPeriod || 'unknown'

    logger.info('Overage billing invoice finalized', {
      invoiceId: invoice.id,
      customerId,
      invoiceAmount,
      billingPeriod,
      customerEmail: invoice.customer_email,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
    })

    // Additional invoice finalization logic can be added here
    // For example: update internal records, trigger notifications, etc.
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
