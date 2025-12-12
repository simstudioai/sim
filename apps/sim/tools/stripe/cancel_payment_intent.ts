import type { CancelPaymentIntentParams, PaymentIntentResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeCancelPaymentIntentTool: ToolConfig<
  CancelPaymentIntentParams,
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
    url: (params) => `https://api.stripe.com/v1/payment_intents/${params.id}/cancel`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
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
      type: 'json',
      description: 'The canceled Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
    },
  },
}
