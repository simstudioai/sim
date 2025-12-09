import type { ToolConfig } from '@/tools/types'
import type {
  KalshiAuthParams,
  KalshiFill,
  KalshiPaginationParams,
  KalshiPagingInfo,
} from './types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetFillsParams extends KalshiAuthParams, KalshiPaginationParams {
  ticker?: string
  orderId?: string
  minTs?: number
  maxTs?: number
}

export interface KalshiGetFillsResponse {
  success: boolean
  output: {
    fills: KalshiFill[]
    paging?: KalshiPagingInfo
  }
}

export const kalshiGetFillsTool: ToolConfig<KalshiGetFillsParams, KalshiGetFillsResponse> = {
  id: 'kalshi_get_fills',
  name: 'Get Fills from Kalshi',
  description: "Retrieve your portfolio's fills/trades from Kalshi",
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
    orderId: {
      type: 'string',
      required: false,
      description: 'Filter by order ID',
    },
    minTs: {
      type: 'number',
      required: false,
      description: 'Minimum timestamp (Unix milliseconds)',
    },
    maxTs: {
      type: 'number',
      required: false,
      description: 'Maximum timestamp (Unix milliseconds)',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results (1-1000, default: 100)',
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
      if (params.orderId) queryParams.append('order_id', params.orderId)
      if (params.minTs !== undefined) queryParams.append('min_ts', params.minTs.toString())
      if (params.maxTs !== undefined) queryParams.append('max_ts', params.maxTs.toString())
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/portfolio/fills')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => {
      const path = '/trade-api/v2/portfolio/fills'
      return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'GET', path)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_fills')
    }

    const fills = data.fills || []

    return {
      success: true,
      output: {
        fills,
        paging: {
          cursor: data.cursor || null,
        },
      },
    }
  },

  outputs: {
    fills: {
      type: 'array',
      description: 'Array of fill/trade objects',
    },
    paging: {
      type: 'object',
      description: 'Pagination cursor for fetching more results',
    },
  },
}
