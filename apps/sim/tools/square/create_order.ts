import { generateId } from '@sim/utils/id'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { CreateOrderParams, OrderResponse } from '@/tools/square/types'
import {
  ORDER_METADATA_OUTPUT_PROPERTIES,
  ORDER_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareCreateOrderTool: ToolConfig<CreateOrderParams, OrderResponse> = {
  id: 'square_create_order',
  name: 'Square Create Order',
  description: 'Create an order with line items, taxes, discounts, and fulfillments',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    order: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Square order object including location_id and line_items (e.g. {"location_id":"L1","line_items":[{"name":"Coffee","quantity":"1","base_price_money":{"amount":250,"currency":"USD"}}]})',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Unique key to make the request idempotent (auto-generated if omitted)',
    },
  },

  request: {
    url: () => `${SQUARE_BASE_URL}/v2/orders`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => ({
      idempotency_key: params.idempotencyKey || generateId(),
      order: params.order,
    }),
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
    order: { ...ORDER_OUTPUT, description: 'The created order object' },
    metadata: {
      type: 'json',
      description: 'Order summary metadata',
      properties: ORDER_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
