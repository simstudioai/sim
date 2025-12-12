import type { ToolConfig } from '@/tools/types'
import type {
  KalshiAuthParams,
  KalshiOrder,
  KalshiPaginationParams,
  KalshiPagingInfo,
} from './types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetOrdersParams extends KalshiAuthParams, KalshiPaginationParams {
  ticker?: string
  eventTicker?: string
  status?: string // resting, canceled, executed
}

export interface KalshiGetOrdersResponse {
  success: boolean
  output: {
    orders: KalshiOrder[]
    paging?: KalshiPagingInfo
    metadata: {
      operation: 'get_orders'
      totalReturned: number
    }
    success: boolean
  }
}

export const kalshiGetOrdersTool: ToolConfig<KalshiGetOrdersParams, KalshiGetOrdersResponse> = {
  id: 'kalshi_get_orders',
  name: 'Get Orders from Kalshi',
  description: 'Retrieve your orders from Kalshi with optional filtering',
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
    ticker: {
      type: 'string',
      required: false,
      description: 'Filter by market ticker',
    },
    eventTicker: {
      type: 'string',
      required: false,
      description: 'Filter by event ticker (max 10 comma-separated)',
    },
    status: {
      type: 'string',
      required: false,
      description: 'Filter by status (resting, canceled, executed)',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results (1-200, default: 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      description: 'Pagination cursor for next page',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.ticker) queryParams.append('ticker', params.ticker)
      if (params.eventTicker) queryParams.append('event_ticker', params.eventTicker)
      if (params.status) queryParams.append('status', params.status)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/portfolio/orders')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => {
      const path = '/trade-api/v2/portfolio/orders'
      return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'GET', path)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_orders')
    }

    const orders = data.orders || []

    return {
      success: true,
      output: {
        orders,
        paging: {
          cursor: data.cursor || null,
        },
        metadata: {
          operation: 'get_orders' as const,
          totalReturned: orders.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Orders data and metadata',
      properties: {
        orders: { type: 'array', description: 'Array of order objects' },
        paging: { type: 'object', description: 'Pagination information' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
