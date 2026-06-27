import type { ToolConfig } from '@/tools/types'
import { transformStripeResponse } from './types'

export const stripeRefundsTool: ToolConfig = {
  id: 'stripe_refunds',
  name: 'Stripe Refunds',
  description:
    'Issue, retrieve, and manage Stripe refunds. Create new refunds, list refund history, and track refund status across your account.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (sk_live_* or sk_test_*)',
    },
    operation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Refund operation to perform',
    },
    refundId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Refund ID (required for retrieve and update operations)',
    },
    chargeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Charge ID to refund (required for create_refund_from_charge)',
    },
    paymentIntentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment intent ID (required for create_refund_from_payment_intent)',
    },
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Refund amount in cents (optional; defaults to full amount)',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for refund (lost_in_transit, fraudulent, duplicate, requested_by_customer, expired_uncaptured_charge)',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom key-value metadata for the refund',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results per page (1-100, default: 10)',
    },
    startingAfter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Refund ID to start pagination after',
    },
    endingBefore: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Refund ID to end pagination before',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expand nested resources (comma-separated, e.g., "charge,payment_intent")',
    },
  },
  outputs: {
    refund: {
      type: 'object',
      description: 'The refund object or list of refunds',
      properties: {
        id: { type: 'string', description: 'Refund ID' },
        object: { type: 'string', description: 'Object type (refund)' },
        amount: { type: 'number', description: 'Refund amount in cents' },
        charge: { type: 'string', description: 'Associated charge ID' },
        created: { type: 'number', description: 'Unix timestamp of creation' },
        reason: { type: 'string', description: 'Refund reason' },
        status: { type: 'string', description: 'Refund status (succeeded, failed, pending)' },
      },
    },
    items: {
      type: 'array',
      description: 'List of refund objects (when listing)',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more results are available (when listing)',
      optional: true,
    },
    error: {
      type: 'string',
      description: 'Error message if request failed',
      optional: true,
    },
  },
  request: {
    url: (params) => {
      const operation = params.operation as string
      const baseUrl = 'https://api.stripe.com/v1'

      switch (operation) {
        case 'list_refunds':
          return `${baseUrl}/refunds`
        case 'create_refund_from_charge':
        case 'create_refund_from_payment_intent':
          return `${baseUrl}/refunds`
        case 'retrieve_refund':
          return `${baseUrl}/refunds/${params.refundId}`
        case 'update_refund':
          return `${baseUrl}/refunds/${params.refundId}`
        default:
          throw new Error(`Unknown operation: ${operation}`)
      }
    },
    method: (params) => {
      const operation = params.operation as string
      switch (operation) {
        case 'list_refunds':
        case 'retrieve_refund':
          return 'GET'
        case 'create_refund_from_charge':
        case 'create_refund_from_payment_intent':
        case 'update_refund':
          return 'POST'
        default:
          return 'GET'
      }
    },
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const operation = params.operation as string
      const formData = new URLSearchParams()

      if (operation === 'create_refund_from_charge') {
        if (params.chargeId) formData.append('charge', params.chargeId as string)
        if (params.amount) formData.append('amount', String(params.amount))
        if (params.reason) formData.append('reason', params.reason as string)
      }

      if (operation === 'create_refund_from_payment_intent') {
        if (params.paymentIntentId)
          formData.append('payment_intent', params.paymentIntentId as string)
        if (params.amount) formData.append('amount', String(params.amount))
        if (params.reason) formData.append('reason', params.reason as string)
      }

      if (operation === 'update_refund') {
        if (params.metadata) {
          const metadata = params.metadata as Record<string, string>
          Object.entries(metadata).forEach(([key, value]) => {
            formData.append(`metadata[${key}]`, value)
          })
        }
      }

      if (operation === 'list_refunds') {
        if (params.limit) formData.append('limit', String(params.limit))
        if (params.startingAfter) formData.append('starting_after', params.startingAfter as string)
        if (params.endingBefore) formData.append('ending_before', params.endingBefore as string)
        if (params.chargeId) formData.append('charge', params.chargeId as string)
        if (params.paymentIntentId)
          formData.append('payment_intent', params.paymentIntentId as string)
      }

      if (params.expand) {
        formData.append('expand[]', params.expand as string)
      }

      return formData.toString()
    },
  },
  transformResponse: transformStripeResponse,
}
