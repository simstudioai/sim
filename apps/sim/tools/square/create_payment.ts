import { generateId } from '@sim/utils/id'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { CreatePaymentParams, PaymentResponse } from '@/tools/square/types'
import {
  PAYMENT_METADATA_OUTPUT_PROPERTIES,
  PAYMENT_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareCreatePaymentTool: ToolConfig<CreatePaymentParams, PaymentResponse> = {
  id: 'square_create_payment',
  name: 'Square Create Payment',
  description: 'Take a payment using a payment source such as a card nonce or a card on file',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    sourceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the payment source (card nonce, card-on-file ID, or wallet token)',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amount in the smallest currency denomination (e.g. 1000 = $10.00)',
    },
    currency: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Three-letter ISO 4217 currency code (e.g. USD)',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Unique key to make the request idempotent (auto-generated if omitted)',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the customer associated with the payment',
    },
    locationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the location where the payment is taken (defaults to the main location)',
    },
    orderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the order associated with the payment',
    },
    referenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional external reference for the payment',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional note attached to the payment',
    },
    autocomplete: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to immediately capture the payment (defaults to true)',
    },
  },

  request: {
    url: () => `${SQUARE_BASE_URL}/v2/payments`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        idempotency_key: params.idempotencyKey || generateId(),
        source_id: params.sourceId,
        amount_money: { amount: params.amount, currency: params.currency },
      }
      if (params.customerId) body.customer_id = params.customerId
      if (params.locationId) body.location_id = params.locationId
      if (params.orderId) body.order_id = params.orderId
      if (params.referenceId) body.reference_id = params.referenceId
      if (params.note) body.note = params.note
      if (params.autocomplete !== undefined) body.autocomplete = params.autocomplete
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const payment = data.payment ?? {}
    return {
      success: true,
      output: {
        payment,
        metadata: {
          id: payment.id,
          status: payment.status ?? null,
          order_id: payment.order_id ?? null,
        },
      },
    }
  },

  outputs: {
    payment: { ...PAYMENT_OUTPUT, description: 'The created payment object' },
    metadata: {
      type: 'json',
      description: 'Payment summary metadata',
      properties: PAYMENT_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
