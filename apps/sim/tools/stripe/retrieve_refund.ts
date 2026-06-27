import type { ToolConfig } from '@/tools/types'

interface RetrieveRefundParams {
  apiKey: string
  id: string
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
  status: 'succeeded' | 'failed' | 'pending'
}

export const stripeRetrieveRefundTool: ToolConfig<RetrieveRefundParams, RefundResponse> = {
  id: 'stripe_retrieve_refund',
  name: 'Stripe Retrieve Refund',
  description: 'Retrieve a refund by ID',
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
      description: 'Refund ID',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/refunds/${params.id}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
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
