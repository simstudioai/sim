import type Stripe from 'stripe'
import {
  renderBillingConfirmationEmail,
  renderInvoiceNotificationEmail,
  renderPaymentFailureEmail,
} from '@/components/emails/render-email'
import { sendEmail } from '@/lib/email/mailer'
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
    })

    // Send billing confirmation email
    try {
      await sendBillingConfirmationEmail(invoice, chargedAmount)
    } catch (emailError) {
      logger.error('Failed to send billing confirmation email', {
        invoiceId: invoice.id,
        customerId,
        error: emailError,
      })
      // Don't fail the entire webhook if email fails
    }

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
    })

    // Send payment failure notification email
    try {
      await sendPaymentFailureEmail(invoice, failedAmount)
    } catch (emailError) {
      logger.error('Failed to send payment failure email', {
        invoiceId: invoice.id,
        customerId,
        error: emailError,
      })
      // Don't fail the entire webhook if email fails
    }

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
    })

    // Send invoice notification email
    try {
      await sendInvoiceNotificationEmail(invoice, invoiceAmount)
    } catch (emailError) {
      logger.error('Failed to send invoice notification email', {
        invoiceId: invoice.id,
        customerId,
        error: emailError,
      })
      // Don't fail the entire webhook if email fails
    }
  } catch (error) {
    logger.error('Failed to handle invoice finalized', {
      eventId: event.id,
      error,
    })
    throw error // Re-throw to signal webhook failure
  }
}

/**
 * Send billing confirmation email to user
 */
async function sendBillingConfirmationEmail(invoice: Stripe.Invoice, chargedAmount: number) {
  const customerEmail = invoice.customer_email
  if (!customerEmail) {
    logger.warn('No customer email found for billing confirmation', { invoiceId: invoice.id })
    return
  }

  const billingPeriod = invoice.metadata?.billingPeriod || 'this month'
  const plan = invoice.metadata?.plan || 'your plan'
  const invoiceUrl = invoice.hosted_invoice_url || undefined

  try {
    const html = await renderBillingConfirmationEmail(
      customerEmail,
      chargedAmount,
      plan,
      billingPeriod,
      invoice.id,
      invoiceUrl
    )

    const result = await sendEmail({
      to: customerEmail,
      subject: `Payment Confirmed - $${chargedAmount.toFixed(2)} for ${billingPeriod}`,
      html,
      from: 'billing@simstudio.ai',
      emailType: 'transactional',
    })

    if (result.success) {
      logger.info('Sent billing confirmation email', {
        invoiceId: invoice.id,
        customerEmail,
        chargedAmount,
      })
    } else {
      logger.error('Failed to send billing confirmation email', {
        invoiceId: invoice.id,
        customerEmail,
        error: result.message,
      })
    }
  } catch (error) {
    logger.error('Error rendering or sending billing confirmation email', {
      invoiceId: invoice.id,
      customerEmail,
      error,
    })
  }
}

/**
 * Send payment failure notification email to user
 */
async function sendPaymentFailureEmail(invoice: Stripe.Invoice, failedAmount: number) {
  const customerEmail = invoice.customer_email
  if (!customerEmail) {
    logger.warn('No customer email found for payment failure notification', {
      invoiceId: invoice.id,
    })
    return
  }

  const billingPeriod = invoice.metadata?.billingPeriod || 'this month'
  const plan = invoice.metadata?.plan || 'your plan'
  const invoiceUrl = invoice.hosted_invoice_url || undefined
  const attemptCount = invoice.attempt_count || 1

  try {
    const html = await renderPaymentFailureEmail(
      customerEmail,
      failedAmount,
      plan,
      billingPeriod,
      invoice.id,
      invoiceUrl,
      attemptCount
    )

    const result = await sendEmail({
      to: customerEmail,
      subject: `Payment Failed - Action Required for $${failedAmount.toFixed(2)} charge`,
      html,
      from: 'billing@simstudio.ai',
      emailType: 'transactional',
    })

    if (result.success) {
      logger.info('Sent payment failure email', {
        invoiceId: invoice.id,
        customerEmail,
        failedAmount,
        attemptCount,
      })
    } else {
      logger.error('Failed to send payment failure email', {
        invoiceId: invoice.id,
        customerEmail,
        error: result.message,
      })
    }
  } catch (error) {
    logger.error('Error rendering or sending payment failure email', {
      invoiceId: invoice.id,
      customerEmail,
      error,
    })
  }
}

/**
 * Send invoice notification email to user
 */
async function sendInvoiceNotificationEmail(invoice: Stripe.Invoice, invoiceAmount: number) {
  const customerEmail = invoice.customer_email
  if (!customerEmail) {
    logger.warn('No customer email found for invoice notification', { invoiceId: invoice.id })
    return
  }

  const billingPeriod = invoice.metadata?.billingPeriod || 'this month'
  const plan = invoice.metadata?.plan || 'your plan'
  const dueDate = invoice.due_date
    ? new Date(invoice.due_date * 1000).toISOString().split('T')[0]
    : 'immediately'
  const invoiceUrl = invoice.hosted_invoice_url || undefined

  try {
    const html = await renderInvoiceNotificationEmail(
      customerEmail,
      invoiceAmount,
      plan,
      billingPeriod,
      invoice.id,
      invoiceUrl,
      dueDate
    )

    const result = await sendEmail({
      to: customerEmail,
      subject: `Usage Invoice - $${invoiceAmount.toFixed(2)} for ${billingPeriod}`,
      html,
      from: 'billing@simstudio.ai',
      emailType: 'transactional',
    })

    if (result.success) {
      logger.info('Sent invoice notification email', {
        invoiceId: invoice.id,
        customerEmail,
        invoiceAmount,
      })
    } else {
      logger.error('Failed to send invoice notification email', {
        invoiceId: invoice.id,
        customerEmail,
        error: result.message,
      })
    }
  } catch (error) {
    logger.error('Error rendering or sending invoice notification email', {
      invoiceId: invoice.id,
      customerEmail,
      error,
    })
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
