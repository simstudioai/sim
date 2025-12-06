import type { ToolConfig } from '@/tools/types'
import type { KalshiAuthParams, KalshiOrder } from './types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetOrderParams extends KalshiAuthParams {
  orderId: string // Order ID to retrieve (required)
}

export interface KalshiGetOrderResponse {
  success: boolean
  output: {
    order: KalshiOrder
    metadata: {
      operation: 'get_order'
    }
    success: boolean
  }
}

export const kalshiGetOrderTool: ToolConfig<KalshiGetOrderParams, KalshiGetOrderResponse> = {
  id: 'kalshi_get_order',
  name: 'Get Order from Kalshi',
  description: 'Retrieve details of a specific order by ID from Kalshi',
  version: '1.0.0',

  params: {
    keyId: {
      type: 'string',
      required: true,
      description: 'Your Kalshi API Key ID',
    },
    privateKey: {
      type: 'string',
      required: true,
      description: 'Your RSA Private Key (PEM format)',
    },
    orderId: {
      type: 'string',
      required: true,
      description: 'The order ID to retrieve',
    },
  },

  request: {
    url: (params) => buildKalshiUrl(`/portfolio/orders/${params.orderId}`),
    method: 'GET',
    headers: (params) => {
      const path = `/trade-api/v2/portfolio/orders/${params.orderId}`
      return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'GET', path)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_order')
    }

    return {
      success: true,
      output: {
        order: data.order,
        metadata: {
          operation: 'get_order' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Order data',
      properties: {
        order: { type: 'object', description: 'The order object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
