import type { ToolConfig } from '@/tools/types'
import type { KalshiAuthParams, KalshiOrder } from './types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiCancelOrderParams extends KalshiAuthParams {
  orderId: string // Order ID to cancel (required)
}

export interface KalshiCancelOrderResponse {
  success: boolean
  output: {
    order: KalshiOrder
    reducedBy: number
  }
}

export const kalshiCancelOrderTool: ToolConfig<KalshiCancelOrderParams, KalshiCancelOrderResponse> =
  {
    id: 'kalshi_cancel_order',
    name: 'Cancel Order on Kalshi',
    description: 'Cancel an existing order on Kalshi',
    version: '1.0.0',

    params: {
      keyId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Your Kalshi API Key ID',
      },
      privateKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Your RSA Private Key (PEM format)',
      },
      orderId: {
        type: 'string',
        required: true,
        description: 'The order ID to cancel',
      },
    },

    request: {
      url: (params) => buildKalshiUrl(`/portfolio/orders/${params.orderId}`),
      method: 'DELETE',
      headers: (params) => {
        const path = `/trade-api/v2/portfolio/orders/${params.orderId}`
        return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'DELETE', path)
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        handleKalshiError(data, response.status, 'cancel_order')
      }

      return {
        success: true,
        output: {
          order: data.order,
          reducedBy: data.reduced_by || 0,
        },
      }
    },

    outputs: {
      order: {
        type: 'object',
        description: 'The canceled order object',
      },
      reducedBy: {
        type: 'number',
        description: 'Number of contracts canceled',
      },
    },
  }
