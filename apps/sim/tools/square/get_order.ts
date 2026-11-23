import { ErrorExtractorId } from '@/tools/error-extractors'
import { SQUARE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { GetOrderParams, OrderResponse } from '@/tools/square/types'
import {
  ORDER_METADATA_OUTPUT_PROPERTIES,
  ORDER_OUTPUT,
  SQUARE_ENVIRONMENTS,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareGetOrderTool: ToolConfig<GetOrderParams, OrderResponse> = {
  id: 'square_get_order',
  name: 'Square Get Order',
  description: 'Retrieve a single order by its ID',
  version: '1.0.0',
  oauth: SQUARE_CREDENTIAL_OAUTH,
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    environment: SQUARE_ENVIRONMENTS.param,
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
      description: 'ID of the order to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${SQUARE_ENVIRONMENTS.apiBase(params.environment)}/v2/orders/${encodeURIComponent(params.orderId)}`,
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
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
    order: { ...ORDER_OUTPUT, description: 'The retrieved order object' },
    metadata: {
      type: 'json',
      description: 'Order summary metadata',
      properties: ORDER_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
