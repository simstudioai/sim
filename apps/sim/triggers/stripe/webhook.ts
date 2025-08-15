import { ShieldCheck } from 'lucide-react'
import type { TriggerConfig } from '../types'

export const stripeWebhookTrigger: TriggerConfig = {
  id: 'stripe_webhook',
  name: 'Stripe Webhook',
  provider: 'stripe',
  description: 'Triggers when Stripe events occur (payments, subscriptions, etc.)',
  version: '1.0.0',
  icon: ShieldCheck,

  configFields: {
    // Stripe webhooks don't require configuration fields - events are selected in Stripe dashboard
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Event ID from Stripe',
    },
    type: {
      type: 'string',
      description: 'Event type (e.g., charge.succeeded, payment_intent.succeeded)',
    },
    created: {
      type: 'string',
      description: 'Timestamp when the event was created',
    },
    data: {
      type: 'string',
      description: 'Event data containing the affected Stripe object',
    },
    object: {
      type: 'string',
      description: 'The Stripe object that was updated (e.g., charge, payment_intent)',
    },
    livemode: {
      type: 'string',
      description: 'Whether this event occurred in live mode or test mode',
    },
    apiVersion: {
      type: 'string',
      description: 'API version used to render this event',
    },
    request: {
      type: 'string',
      description: 'Information about the request that triggered this event',
    },
  },

  instructions: [
    'Go to your Stripe Dashboard at https://dashboard.stripe.com/',
    'Navigate to Developers > Webhooks',
    'Click "Add endpoint"',
    'Paste the Webhook URL (from above) into the "Endpoint URL" field',
    'Select the events you want to listen to (e.g., charge.succeeded)',
    'Click "Add endpoint"',
    'Stripe will send a test event to verify your webhook endpoint',
  ],

  samplePayload: {
    id: 'evt_1234567890',
    type: 'charge.succeeded',
    created: 1641234567,
    data: {
      object: {
        id: 'ch_1234567890',
        object: 'charge',
        amount: 2500,
        currency: 'usd',
        description: 'Sample charge',
        paid: true,
        status: 'succeeded',
        customer: 'cus_1234567890',
        receipt_email: 'customer@example.com',
      },
    },
    object: 'event',
    livemode: false,
    api_version: '2020-08-27',
    request: {
      id: 'req_1234567890',
      idempotency_key: null,
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
