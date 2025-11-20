import type { CapturePaymentIntentParams, PaymentIntentResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeCapturePaymentIntentTool: ToolConfig<
  CapturePaymentIntentParams,
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
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
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
      type: 'json',
      description: 'The captured Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
    },
  },
}
