import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { CapturePaymentIntentParams, PaymentIntentResponse } from '@/tools/stripe/types'
import {
  PAYMENT_INTENT_METADATA_OUTPUT_PROPERTIES,
  PAYMENT_INTENT_OUTPUT,
} from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

const DELIVERY = defineStripeKeyedSite(
  'stripe_capture_payment_intent',
  'the authorization would be captured again and the cardholder would be billed twice'
)

export const stripeCapturePaymentIntentTool: ToolConfig<
  CapturePaymentIntentParams & StripeDeliveryContextParams,
  PaymentIntentResponse
> = {
  id: 'stripe_capture_payment_intent',
  name: 'Stripe Capture Payment Intent',
  description: 'Capture an authorized Payment Intent',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Payment Intent ID (e.g., pi_1234567890)',
    },
    amount_to_capture: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount to capture in cents (defaults to full amount)',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/payment_intents/${params.id}/capture`,
    method: 'POST',
    /**
     * The `Idempotency-Key` must be the *same* on every delivery of one
     * instruction rather than fresh per attempt — it is what lets Stripe
     * recognize a resend and replay its first answer instead of acting again. A
     * value minted at request-build time is the inverse of the header's purpose:
     * it is stable only inside the transport loop, and every retry layer above
     * that re-enters tool preparation and looks to Stripe like a new write.
     */
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...stripeIdempotencyHeader(DELIVERY, params),
    }),
    body: (params) => {
      const formData = new URLSearchParams()
      if (params.amount_to_capture) {
        formData.append('amount_to_capture', Number(params.amount_to_capture).toString())
      }
      return { body: formData.toString() }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        payment_intent: data,
        metadata: {
          id: data.id,
          status: data.status,
          amount: data.amount,
          currency: data.currency,
        },
      },
    }
  },

  outputs: {
    payment_intent: {
      ...PAYMENT_INTENT_OUTPUT,
      description: 'The captured Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
      properties: PAYMENT_INTENT_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
