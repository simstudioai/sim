import type {
  KalshiAuthParams,
  KalshiFill,
  KalshiPaginationParams,
  KalshiPagingInfo,
} from '@/tools/kalshi/types'
import {
  buildKalshiAuthHeaders,
  buildKalshiUrl,
  handleKalshiError,
  KALSHI_FILL_OUTPUT_PROPERTIES,
} from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-or-llm',
      description: 'Filter by market ticker (e.g., "KXBTC-24DEC31")',
    },
    orderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by order ID (e.g., "abc123-def456-ghi789")',
    },
    minTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum timestamp in Unix milliseconds (e.g., 1704067200000)',
    },
    maxTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum timestamp in Unix milliseconds (e.g., 1704153600000)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (1-1000, default: 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response for fetching next page',
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
      items: {
        type: 'object',
        properties: KALSHI_FILL_OUTPUT_PROPERTIES,
      },
    },
    paging: {
      type: 'object',
      description: 'Pagination cursor for fetching more results',
    },
  },
}

/**
 * V2 Params for Get Fills - fixes limit max to 200, adds subaccount
 */
export interface KalshiGetFillsV2Params extends KalshiAuthParams, KalshiPaginationParams {
  ticker?: string
  orderId?: string
  minTs?: number
  maxTs?: number
  subaccount?: string
}

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetFillsV2Response {
  success: boolean
  output: {
    fills: Array<{
      fill_id: string
      trade_id: string
      order_id: string
      client_order_id: string | null
      ticker: string
      market_ticker: string
      side: string
      action: string
      count: number
      count_fp: string | null
      price: number | null
      yes_price: number
      no_price: number
      yes_price_fixed: string | null
      no_price_fixed: string | null
      is_taker: boolean
      created_time: string | null
      ts: number | null
    }>
    cursor: string | null
  }
}

export const kalshiGetFillsV2Tool: ToolConfig<KalshiGetFillsV2Params, KalshiGetFillsV2Response> = {
  id: 'kalshi_get_fills_v2',
  name: 'Get Fills from Kalshi V2',
  description: "Retrieve your portfolio's fills/trades from Kalshi (V2 - exact API response)",
  version: '2.0.0',

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
      visibility: 'user-or-llm',
      description: 'Filter by market ticker (e.g., "KXBTC-24DEC31")',
    },
    orderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by order ID (e.g., "abc123-def456-ghi789")',
    },
    minTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum timestamp in Unix milliseconds (e.g., 1704067200000)',
    },
    maxTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum timestamp in Unix milliseconds (e.g., 1704153600000)',
    },
    subaccount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subaccount identifier to get fills for',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (1-200, default: 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response for fetching next page',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.ticker) queryParams.append('ticker', params.ticker)
      if (params.orderId) queryParams.append('order_id', params.orderId)
      if (params.minTs !== undefined) queryParams.append('min_ts', params.minTs.toString())
      if (params.maxTs !== undefined) queryParams.append('max_ts', params.maxTs.toString())
      if (params.subaccount) queryParams.append('subaccount', params.subaccount)
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
      handleKalshiError(data, response.status, 'get_fills_v2')
    }

    const fills = (data.fills || []).map((f: Record<string, unknown>) => ({
      fill_id: f.fill_id ?? null,
      trade_id: f.trade_id ?? null,
      order_id: f.order_id ?? null,
      client_order_id: f.client_order_id ?? null,
      ticker: f.ticker ?? null,
      market_ticker: f.market_ticker ?? null,
      side: f.side ?? null,
      action: f.action ?? null,
      count: f.count ?? 0,
      count_fp: f.count_fp ?? null,
      price: f.price ?? null,
      yes_price: f.yes_price ?? 0,
      no_price: f.no_price ?? 0,
      yes_price_fixed: f.yes_price_fixed ?? null,
      no_price_fixed: f.no_price_fixed ?? null,
      is_taker: f.is_taker ?? false,
      created_time: f.created_time ?? null,
      ts: f.ts ?? null,
    }))

    return {
      success: true,
      output: {
        fills,
        cursor: data.cursor ?? null,
      },
    }
  },

  outputs: {
    fills: {
      type: 'array',
      description: 'Array of fill/trade objects with all API fields',
      items: {
        type: 'object',
        properties: KALSHI_FILL_OUTPUT_PROPERTIES,
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for fetching more results',
    },
  },
}
