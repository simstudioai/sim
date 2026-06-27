import type { ToolConfig } from '@/tools/types'

interface ListRefundsParams {
  apiKey: string
  chargeId?: string
  paymentIntentId?: string
  limit?: number
  startingAfter?: string
}

interface RefundResponse {
  id: string
  object: 'refund'
  amount: number
  charge: string
  created: number
  currency: string
  metadata: Record<string, string>
  reason: string | null
  status: 'succeeded' | 'failed' | 'pending'
}

interface ListRefundsResponse {
  object: 'list'
  data: RefundResponse[]
  has_more: boolean
  url: string
}

export const stripeListRefundsTool: ToolConfig<ListRefundsParams, ListRefundsResponse> = {
  id: 'stripe_list_refunds',
  name: 'Stripe List Refunds',
  description: 'List refunds for a charge or payment intent',
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
      description: 'Filter refunds for a specific charge ID',
    },
    paymentIntentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter refunds for a specific payment intent ID',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of refunds to return (default: 10, max: 100)',
    },
    startingAfter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'For pagination: refund ID to start after',
    },
  },

  request: {
    url: () => 'https://api.stripe.com/v1/refunds',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
    query: (params) => {
      const q: Record<string, string> = {}
      if (params.chargeId) q['charge'] = params.chargeId
      if (params.paymentIntentId) q['payment_intent'] = params.paymentIntentId
      if (params.limit) q['limit'] = String(params.limit)
      if (params.startingAfter) q['starting_after'] = params.startingAfter
      return q
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        refunds: data.data || [],
        hasMore: data.has_more || false,
        nextCursor: data.data && data.data.length > 0 ? data.data[data.data.length - 1].id : null,
      },
    }
  },

  outputs: {
    refunds: { type: 'json', description: 'Array of refund objects' },
    hasMore: { type: 'boolean', description: 'Whether more refunds are available' },
    nextCursor: { type: 'string', description: 'ID to use for pagination' },
  },
}
