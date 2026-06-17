import { generateId } from '@sim/utils/id'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { OrderResponse, PayOrderParams } from '@/tools/square/types'
import {
  ORDER_METADATA_OUTPUT_PROPERTIES,
  ORDER_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squarePayOrderTool: ToolConfig<PayOrderParams, OrderResponse> = {
  id: 'square_pay_order',
  name: 'Square Pay Order',
  description: 'Pay for an order using one or more already-approved payments',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    orderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the order to pay for',
    },
    paymentIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'IDs of approved payments to apply to the order',
    },
    orderVersion: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version of the order being paid (for optimistic concurrency)',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Unique key to make the request idempotent (auto-generated if omitted)',
    },
  },

  request: {
    url: (params) => `${SQUARE_BASE_URL}/v2/orders/${encodeURIComponent(params.orderId)}/pay`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        idempotency_key: params.idempotencyKey || generateId(),
      }
      if (params.paymentIds) body.payment_ids = params.paymentIds
      if (params.orderVersion !== undefined) body.order_version = params.orderVersion
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const order = data.order ?? {}
    return {
      success: true,
      output: {
        order,
        metadata: {
          id: order.id,
          state: order.state ?? null,
          location_id: order.location_id ?? null,
        },
      },
    }
  },

  outputs: {
    order: { ...ORDER_OUTPUT, description: 'The paid order object' },
    metadata: {
      type: 'json',
      description: 'Order summary metadata',
      properties: ORDER_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
