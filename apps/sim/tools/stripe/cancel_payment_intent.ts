import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { CancelPaymentIntentParams, PaymentIntentResponse } from '@/tools/stripe/types'
import {
  PAYMENT_INTENT_METADATA_OUTPUT_PROPERTIES,
  PAYMENT_INTENT_OUTPUT,
} from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const DELIVERY = defineStripeKeyedSite(
  'stripe_cancel_payment_intent',
  'the resend is rejected because the intent is already canceled, so a payment that was cancelled cleanly is reported back to the user as a failed run'
)

export const stripeCancelPaymentIntentTool: ToolConfig<
  CancelPaymentIntentParams & StripeDeliveryContextParams,
  PaymentIntentResponse
> = {
  id: 'stripe_cancel_payment_intent',
  name: 'Stripe Cancel Payment Intent',
  description: 'Cancel a Payment Intent',
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
    cancellation_reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Reason for cancellation (duplicate, fraudulent, requested_by_customer, abandoned)',
    },
  },

  request: {
    url: (params) =>
      `https://api.stripe.com/v1/payment_intents/${safeUrlPathSegment(params.id, 'id')}/cancel`,
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
      if (params.cancellation_reason) {
        formData.append('cancellation_reason', params.cancellation_reason)
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
      description: 'The canceled Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
      properties: PAYMENT_INTENT_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
