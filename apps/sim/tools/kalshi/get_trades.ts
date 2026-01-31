import type { KalshiPaginationParams, KalshiPagingInfo, KalshiTrade } from '@/tools/kalshi/types'
import {
  buildKalshiUrl,
  handleKalshiError,
  KALSHI_TRADE_OUTPUT_PROPERTIES,
} from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetTradesParams extends KalshiPaginationParams {}

export interface KalshiGetTradesResponse {
  success: boolean
  output: {
    trades: KalshiTrade[]
    paging?: KalshiPagingInfo
  }
}

export const kalshiGetTradesTool: ToolConfig<KalshiGetTradesParams, KalshiGetTradesResponse> = {
  id: 'kalshi_get_trades',
  name: 'Get Trades from Kalshi',
  description: 'Retrieve recent trades across all markets',
  version: '1.0.0',

  params: {
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
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/markets/trades')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_trades')
    }

    const trades = data.trades || []

    return {
      success: true,
      output: {
        trades,
        paging: {
          cursor: data.cursor || null,
        },
      },
    }
  },

  outputs: {
    trades: {
      type: 'array',
      description: 'Array of trade objects',
      items: {
        type: 'object',
        properties: KALSHI_TRADE_OUTPUT_PROPERTIES,
      },
    },
    paging: {
      type: 'object',
      description: 'Pagination cursor for fetching more results',
    },
  },
}

/**
 * V2 Get Trades Tool - Returns exact Kalshi API response structure with additional params
 */
export interface KalshiGetTradesV2Params extends KalshiPaginationParams {
  ticker?: string // Filter by market ticker
  minTs?: number // Minimum timestamp (Unix seconds)
  maxTs?: number // Maximum timestamp (Unix seconds)
}

export interface KalshiGetTradesV2Response {
  success: boolean
  output: {
    trades: Array<{
      trade_id: string | null
      ticker: string
      yes_price: number | null
      no_price: number | null
      count: number | null
      count_fp: number | null
      created_time: string | null
      taker_side: string | null
    }>
    cursor: string | null
  }
}

export const kalshiGetTradesV2Tool: ToolConfig<KalshiGetTradesV2Params, KalshiGetTradesV2Response> =
  {
    id: 'kalshi_get_trades_v2',
    name: 'Get Trades from Kalshi V2',
    description:
      'Retrieve recent trades with additional filtering options (V2 - includes trade_id and count_fp)',
    version: '2.0.0',

    params: {
      ticker: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter by market ticker (e.g., "KXBTC-24DEC31")',
      },
      minTs: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Minimum timestamp in Unix seconds (e.g., 1704067200)',
      },
      maxTs: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum timestamp in Unix seconds (e.g., 1704153600)',
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
        if (params.minTs) queryParams.append('min_ts', params.minTs.toString())
        if (params.maxTs) queryParams.append('max_ts', params.maxTs.toString())
        if (params.limit) queryParams.append('limit', params.limit)
        if (params.cursor) queryParams.append('cursor', params.cursor)

        const query = queryParams.toString()
        const url = buildKalshiUrl('/markets/trades')
        return query ? `${url}?${query}` : url
      },
      method: 'GET',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        handleKalshiError(data, response.status, 'get_trades_v2')
      }

      const trades = (data.trades || []).map((t: Record<string, unknown>) => ({
        trade_id: t.trade_id ?? null,
        ticker: t.ticker ?? null,
        yes_price: t.yes_price ?? null,
        no_price: t.no_price ?? null,
        count: t.count ?? null,
        count_fp: t.count_fp ?? null,
        created_time: t.created_time ?? null,
        taker_side: t.taker_side ?? null,
      }))

      return {
        success: true,
        output: {
          trades,
          cursor: data.cursor ?? null,
        },
      }
    },

    outputs: {
      trades: {
        type: 'array',
        description: 'Array of trade objects with trade_id and count_fp',
        items: {
          type: 'object',
          properties: KALSHI_TRADE_OUTPUT_PROPERTIES,
        },
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor for fetching more results',
      },
    },
  }
