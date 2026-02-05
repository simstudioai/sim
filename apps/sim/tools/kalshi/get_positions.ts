import type {
  KalshiAuthParams,
  KalshiPaginationParams,
  KalshiPagingInfo,
  KalshiPosition,
} from '@/tools/kalshi/types'
import {
  buildKalshiAuthHeaders,
  buildKalshiUrl,
  handleKalshiError,
  KALSHI_EVENT_POSITION_OUTPUT_PROPERTIES,
  KALSHI_POSITION_OUTPUT_PROPERTIES,
} from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetPositionsParams extends KalshiAuthParams, KalshiPaginationParams {
  ticker?: string
  eventTicker?: string
  settlementStatus?: string // all, unsettled, settled
}

export interface KalshiGetPositionsResponse {
  success: boolean
  output: {
    positions: KalshiPosition[]
    paging?: KalshiPagingInfo
  }
}

export const kalshiGetPositionsTool: ToolConfig<
  KalshiGetPositionsParams,
  KalshiGetPositionsResponse
> = {
  id: 'kalshi_get_positions',
  name: 'Get Positions from Kalshi',
  description: 'Retrieve your open positions from Kalshi',
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
    eventTicker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by event ticker, max 10 comma-separated (e.g., "KXBTC-24DEC31,INX-25JAN03")',
    },
    settlementStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by settlement status: "all", "unsettled", or "settled" (default: "unsettled")',
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
      if (params.eventTicker) queryParams.append('event_ticker', params.eventTicker)
      if (params.settlementStatus) queryParams.append('settlement_status', params.settlementStatus)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/portfolio/positions')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => {
      const path = '/trade-api/v2/portfolio/positions'
      return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'GET', path)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_positions')
    }

    const positions = data.market_positions || data.positions || []

    return {
      success: true,
      output: {
        positions,
        paging: {
          cursor: data.cursor || null,
        },
      },
    }
  },

  outputs: {
    positions: {
      type: 'array',
      description: 'Array of position objects',
      items: {
        type: 'object',
        properties: KALSHI_POSITION_OUTPUT_PROPERTIES,
      },
    },
    paging: {
      type: 'object',
      description: 'Pagination cursor for fetching more results',
    },
  },
}

/**
 * V2 Params for Get Positions - removes invalid settlementStatus, adds countFilter and subaccount
 */
export interface KalshiGetPositionsV2Params extends KalshiAuthParams, KalshiPaginationParams {
  ticker?: string
  eventTicker?: string
  countFilter?: string
  subaccount?: string
}

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetPositionsV2Response {
  success: boolean
  output: {
    market_positions: Array<{
      ticker: string
      event_ticker: string
      event_title: string | null
      market_title: string | null
      position: number
      market_exposure: number | null
      realized_pnl: number | null
      total_traded: number | null
      resting_orders_count: number | null
      fees_paid: number | null
    }>
    event_positions: Array<{
      event_ticker: string
      event_exposure: number
      realized_pnl: number | null
      total_cost: number | null
    }> | null
    cursor: string | null
  }
}

export const kalshiGetPositionsV2Tool: ToolConfig<
  KalshiGetPositionsV2Params,
  KalshiGetPositionsV2Response
> = {
  id: 'kalshi_get_positions_v2',
  name: 'Get Positions from Kalshi V2',
  description: 'Retrieve your open positions from Kalshi (V2 - exact API response)',
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
    eventTicker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by event ticker, max 10 comma-separated (e.g., "KXBTC-24DEC31,INX-25JAN03")',
    },
    countFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by count: "all", "positive", or "negative" (default: "all")',
    },
    subaccount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subaccount identifier to get positions for',
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
      if (params.eventTicker) queryParams.append('event_ticker', params.eventTicker)
      if (params.countFilter) queryParams.append('count_filter', params.countFilter)
      if (params.subaccount) queryParams.append('subaccount', params.subaccount)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/portfolio/positions')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => {
      const path = '/trade-api/v2/portfolio/positions'
      return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'GET', path)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_positions_v2')
    }

    const marketPositions = (data.market_positions || []).map((p: Record<string, unknown>) => ({
      ticker: p.ticker ?? null,
      event_ticker: p.event_ticker ?? null,
      event_title: p.event_title ?? null,
      market_title: p.market_title ?? null,
      position: p.position ?? 0,
      market_exposure: p.market_exposure ?? null,
      realized_pnl: p.realized_pnl ?? null,
      total_traded: p.total_traded ?? null,
      resting_orders_count: p.resting_orders_count ?? null,
      fees_paid: p.fees_paid ?? null,
    }))

    const eventPositions = data.event_positions
      ? (data.event_positions as Array<Record<string, unknown>>).map((p) => ({
          event_ticker: (p.event_ticker as string) ?? '',
          event_exposure: (p.event_exposure as number) ?? 0,
          realized_pnl: (p.realized_pnl as number | null) ?? null,
          total_cost: (p.total_cost as number | null) ?? null,
        }))
      : null

    return {
      success: true,
      output: {
        market_positions: marketPositions,
        event_positions: eventPositions,
        cursor: data.cursor ?? null,
      },
    }
  },

  outputs: {
    market_positions: {
      type: 'array',
      description: 'Array of market position objects',
      items: {
        type: 'object',
        properties: KALSHI_POSITION_OUTPUT_PROPERTIES,
      },
    },
    event_positions: {
      type: 'array',
      description: 'Array of event position objects',
      items: {
        type: 'object',
        properties: KALSHI_EVENT_POSITION_OUTPUT_PROPERTIES,
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for fetching more results',
    },
  },
}
