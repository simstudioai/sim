import type { ToolConfig } from '@/tools/types'

interface CreateRefundParams {
  apiKey: string
  chargeId?: string
  paymentIntentId?: string
  amount?: number
  reason?: string
  metadata?: Record<string, string>
}

interface RefundResponse {
  id: string
  object: 'refund'
  amount: number
  balance_transaction: string | null
  charge: string
  created: number
  currency: string
  metadata: Record<string, string>
  reason: string | null
  receipt_number: string | null
  source_transfer_reversal: string | null
  status: 'succeeded' | 'failed' | 'pending'
  transfer_reversal: string | null
}

export const stripeCreateRefundTool: ToolConfig<CreateRefundParams, RefundResponse> = {
  id: 'stripe_create_refund',
  name: 'Stripe Create Refund',
  description: 'Create a refund for a charge or payment intent',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    chargeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the charge to refund. Either chargeId or paymentIntentId is required.',
    },
    paymentIntentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the payment intent to refund. Either chargeId or paymentIntentId is required.',
    },
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount to refund in cents. If not specified, full amount is refunded.',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for the refund: requested_by_customer, duplicate, fraudulent, or other',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs to store additional information',
    },
  },

  request: {
    url: () => 'https://api.stripe.com/v1/refunds',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      if (params.chargeId) formData.append('charge', params.chargeId)
      if (params.paymentIntentId) formData.append('payment_intent', params.paymentIntentId)
      if (params.amount !== undefined) formData.append('amount', String(params.amount))
      if (params.reason) formData.append('reason', params.reason)

      if (params.metadata) {
        Object.entries(params.metadata).forEach(([key, value]) => {
          formData.append(`metadata[${key}]`, String(value))
        })
      }

      return { body: formData.toString() }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    id: { type: 'string', description: 'Refund ID' },
    object: { type: 'string', description: 'Object type' },
    amount: { type: 'number', description: 'Refund amount in cents' },
    charge: { type: 'string', description: 'ID of the charge refunded' },
    created: { type: 'number', description: 'Unix timestamp when refund was created' },
    currency: { type: 'string', description: 'Three-letter ISO currency code' },
    metadata: { type: 'json', description: 'Additional metadata' },
    reason: { type: 'string', description: 'Reason for the refund' },
    status: { type: 'string', description: 'Status of the refund' },
  },
}
