import { ErrorExtractorId } from '@/tools/error-extractors'
import type { OrderListResponse, SearchOrdersParams } from '@/tools/square/types'
import {
  LIST_METADATA_OUTPUT_PROPERTIES,
  ORDER_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareSearchOrdersTool: ToolConfig<SearchOrdersParams, OrderListResponse> = {
  id: 'square_search_orders',
  name: 'Square Search Orders',
  description: 'Search orders across one or more locations using filters and sorting',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    locationIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of location IDs to search within',
    },
    query: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Square order query object with optional filter and sort (e.g. {"filter":{"state_filter":{"states":["OPEN"]}}})',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return per page',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: () => `${SQUARE_BASE_URL}/v2/orders/search`,
    method: 'POST',
    headers: (params) => squareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        location_ids: params.locationIds,
      }
      if (params.query) body.query = params.query
      if (params.limit !== undefined) body.limit = params.limit
      if (params.cursor) body.cursor = params.cursor
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const orders = data.orders ?? []
    return {
      success: true,
      output: {
        orders,
        metadata: {
          count: orders.length,
          cursor: data.cursor ?? null,
        },
      },
    }
  },

  outputs: {
    orders: {
      type: 'array',
      description: 'Array of matching order objects',
      items: ORDER_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List pagination metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
