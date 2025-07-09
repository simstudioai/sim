import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { handleInvoiceWebhook } from '@/lib/billing/webhooks/stripe-invoice-webhooks'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('StripeInvoiceWebhook')

/**
 * Stripe billing webhook endpoint for invoice-related events
 * Endpoint: /api/billing/webhooks/stripe
 * Handles: invoice.payment_succeeded, invoice.payment_failed, invoice.finalized
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const headersList = await headers()
    const signature = headersList.get('stripe-signature')

    if (!signature) {
      logger.error('Missing Stripe signature header')
      return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 })
    }

    if (!env.STRIPE_WEBHOOK_SECRET) {
      logger.error('Missing Stripe webhook secret configuration')
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
    }

    // Check if Stripe client is available
    let stripe
    try {
      stripe = requireStripeClient()
    } catch (stripeError) {
      logger.error('Stripe client not available for webhook processing', {
        error: stripeError,
      })
      return NextResponse.json({ error: 'Stripe client not configured' }, { status: 500 })
    }

    // Verify webhook signature
    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET)
    } catch (signatureError) {
      logger.error('Invalid Stripe webhook signature', {
        error: signatureError,
        signature,
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    logger.info('Received Stripe invoice webhook', {
      eventId: event.id,
      eventType: event.type,
    })

    // Handle specific invoice events
    const supportedEvents = [
      'invoice.payment_succeeded',
      'invoice.payment_failed',
      'invoice.finalized',
    ]

    if (supportedEvents.includes(event.type)) {
      try {
        await handleInvoiceWebhook(event)

        logger.info('Successfully processed invoice webhook', {
          eventId: event.id,
          eventType: event.type,
        })

        return NextResponse.json({ received: true })
      } catch (processingError) {
        logger.error('Failed to process invoice webhook', {
          eventId: event.id,
          eventType: event.type,
          error: processingError,
        })

        // Return 500 to tell Stripe to retry the webhook
        return NextResponse.json({ error: 'Failed to process webhook' }, { status: 500 })
      }
    } else {
      // Not a supported invoice event, ignore
      logger.info('Ignoring unsupported webhook event', {
        eventId: event.id,
        eventType: event.type,
        supportedEvents,
      })

      return NextResponse.json({ received: true })
    }
  } catch (error) {
    logger.error('Fatal error in invoice webhook handler', {
      error,
      url: request.url,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET endpoint for webhook health checks
 */
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    webhook: 'stripe-invoices',
    events: ['invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.finalized'],
  })
}
