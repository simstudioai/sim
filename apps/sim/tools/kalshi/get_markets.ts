import type { KalshiMarket, KalshiPaginationParams, KalshiPagingInfo } from '@/tools/kalshi/types'
import {
  buildKalshiUrl,
  handleKalshiError,
  KALSHI_MARKET_OUTPUT_PROPERTIES,
  KALSHI_PAGING_OUTPUT_PROPERTIES,
} from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetMarketsParams extends KalshiPaginationParams {
  status?: string // unopened, open, closed, settled
  seriesTicker?: string
  eventTicker?: string
}

export interface KalshiGetMarketsResponse {
  success: boolean
  output: {
    markets: KalshiMarket[]
    paging?: KalshiPagingInfo
  }
}

export const kalshiGetMarketsTool: ToolConfig<KalshiGetMarketsParams, KalshiGetMarketsResponse> = {
  id: 'kalshi_get_markets',
  name: 'Get Markets from Kalshi',
  description: 'Retrieve a list of prediction markets from Kalshi with optional filtering',
  version: '1.0.0',

  params: {
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by market status: "unopened", "open", "closed", or "settled"',
    },
    seriesTicker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by series ticker (e.g., "KXBTC", "INX", "FED-RATE")',
    },
    eventTicker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by event ticker (e.g., "KXBTC-24DEC31", "INX-25JAN03")',
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
      if (params.status) queryParams.append('status', params.status)
      if (params.seriesTicker) queryParams.append('series_ticker', params.seriesTicker)
      if (params.eventTicker) queryParams.append('event_ticker', params.eventTicker)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/markets')
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
      handleKalshiError(data, response.status, 'get_markets')
    }

    const markets = data.markets || []

    return {
      success: true,
      output: {
        markets,
        paging: {
          cursor: data.cursor || null,
        },
      },
    }
  },

  outputs: {
    markets: {
      type: 'array',
      description: 'Array of market objects',
      items: {
        type: 'object',
        properties: KALSHI_MARKET_OUTPUT_PROPERTIES,
      },
    },
    paging: {
      type: 'object',
      description: 'Pagination cursor for fetching more results',
      properties: KALSHI_PAGING_OUTPUT_PROPERTIES,
    },
  },
}

/**
 * V2 Get Markets Tool - Returns exact Kalshi API response structure with all params
 */
export interface KalshiGetMarketsV2Params extends KalshiPaginationParams {
  status?: string // unopened, open, closed, settled
  seriesTicker?: string
  eventTicker?: string
  minCreatedTs?: number
  maxCreatedTs?: number
  minUpdatedTs?: number
  minCloseTs?: number
  maxCloseTs?: number
  minSettledTs?: number
  maxSettledTs?: number
  tickers?: string // comma-separated list
  mveFilter?: string // display or all
}

export interface KalshiGetMarketsV2Response {
  success: boolean
  output: {
    markets: Array<{
      ticker: string
      event_ticker: string
      market_type: string
      title: string
      subtitle: string | null
      yes_sub_title: string | null
      no_sub_title: string | null
      open_time: string | null
      close_time: string | null
      expected_expiration_time: string | null
      expiration_time: string | null
      latest_expiration_time: string | null
      settlement_timer_seconds: number | null
      status: string
      response_price_units: string | null
      notional_value: number | null
      tick_size: number | null
      yes_bid: number | null
      yes_ask: number | null
      no_bid: number | null
      no_ask: number | null
      last_price: number | null
      previous_yes_bid: number | null
      previous_yes_ask: number | null
      previous_price: number | null
      volume: number | null
      volume_24h: number | null
      liquidity: number | null
      open_interest: number | null
      result: string | null
      cap_strike: number | null
      floor_strike: number | null
      can_close_early: boolean | null
      expiration_value: string | null
      category: string | null
      risk_limit_cents: number | null
      strike_type: string | null
      rules_primary: string | null
      rules_secondary: string | null
      settlement_source_url: string | null
      custom_strike: object | null
      underlying: string | null
      settlement_value: number | null
      cfd_contract_size: number | null
      yes_fee_fp: number | null
      no_fee_fp: number | null
      last_price_fp: number | null
      yes_bid_fp: number | null
      yes_ask_fp: number | null
      no_bid_fp: number | null
      no_ask_fp: number | null
    }>
    cursor: string | null
  }
}

export const kalshiGetMarketsV2Tool: ToolConfig<
  KalshiGetMarketsV2Params,
  KalshiGetMarketsV2Response
> = {
  id: 'kalshi_get_markets_v2',
  name: 'Get Markets from Kalshi V2',
  description:
    'Retrieve a list of prediction markets from Kalshi with all filtering options (V2 - full API response)',
  version: '2.0.0',

  params: {
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by market status: "unopened", "open", "closed", or "settled"',
    },
    seriesTicker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by series ticker (e.g., "KXBTC", "INX", "FED-RATE")',
    },
    eventTicker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by event ticker (e.g., "KXBTC-24DEC31", "INX-25JAN03")',
    },
    minCreatedTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum created timestamp in Unix seconds (e.g., 1704067200)',
    },
    maxCreatedTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum created timestamp in Unix seconds (e.g., 1704153600)',
    },
    minUpdatedTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum updated timestamp in Unix seconds (e.g., 1704067200)',
    },
    minCloseTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum close timestamp in Unix seconds (e.g., 1704067200)',
    },
    maxCloseTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum close timestamp in Unix seconds (e.g., 1704153600)',
    },
    minSettledTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum settled timestamp in Unix seconds (e.g., 1704067200)',
    },
    maxSettledTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum settled timestamp in Unix seconds (e.g., 1704153600)',
    },
    tickers: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tickers (e.g., "KXBTC-24DEC31,INX-25JAN03")',
    },
    mveFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'MVE filter: "display" or "all"',
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
      if (params.status) queryParams.append('status', params.status)
      if (params.seriesTicker) queryParams.append('series_ticker', params.seriesTicker)
      if (params.eventTicker) queryParams.append('event_ticker', params.eventTicker)
      if (params.minCreatedTs) queryParams.append('min_created_ts', params.minCreatedTs.toString())
      if (params.maxCreatedTs) queryParams.append('max_created_ts', params.maxCreatedTs.toString())
      if (params.minUpdatedTs) queryParams.append('min_updated_ts', params.minUpdatedTs.toString())
      if (params.minCloseTs) queryParams.append('min_close_ts', params.minCloseTs.toString())
      if (params.maxCloseTs) queryParams.append('max_close_ts', params.maxCloseTs.toString())
      if (params.minSettledTs) queryParams.append('min_settled_ts', params.minSettledTs.toString())
      if (params.maxSettledTs) queryParams.append('max_settled_ts', params.maxSettledTs.toString())
      if (params.tickers) queryParams.append('tickers', params.tickers)
      if (params.mveFilter) queryParams.append('mve_filter', params.mveFilter)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/markets')
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
      handleKalshiError(data, response.status, 'get_markets_v2')
    }

    const markets = (data.markets || []).map((m: Record<string, unknown>) => ({
      ticker: m.ticker ?? null,
      event_ticker: m.event_ticker ?? null,
      market_type: m.market_type ?? null,
      title: m.title ?? null,
      subtitle: m.subtitle ?? null,
      yes_sub_title: m.yes_sub_title ?? null,
      no_sub_title: m.no_sub_title ?? null,
      open_time: m.open_time ?? null,
      close_time: m.close_time ?? null,
      expected_expiration_time: m.expected_expiration_time ?? null,
      expiration_time: m.expiration_time ?? null,
      latest_expiration_time: m.latest_expiration_time ?? null,
      settlement_timer_seconds: m.settlement_timer_seconds ?? null,
      status: m.status ?? null,
      response_price_units: m.response_price_units ?? null,
      notional_value: m.notional_value ?? null,
      tick_size: m.tick_size ?? null,
      yes_bid: m.yes_bid ?? null,
      yes_ask: m.yes_ask ?? null,
      no_bid: m.no_bid ?? null,
      no_ask: m.no_ask ?? null,
      last_price: m.last_price ?? null,
      previous_yes_bid: m.previous_yes_bid ?? null,
      previous_yes_ask: m.previous_yes_ask ?? null,
      previous_price: m.previous_price ?? null,
      volume: m.volume ?? null,
      volume_24h: m.volume_24h ?? null,
      liquidity: m.liquidity ?? null,
      open_interest: m.open_interest ?? null,
      result: m.result ?? null,
      cap_strike: m.cap_strike ?? null,
      floor_strike: m.floor_strike ?? null,
      can_close_early: m.can_close_early ?? null,
      expiration_value: m.expiration_value ?? null,
      category: m.category ?? null,
      risk_limit_cents: m.risk_limit_cents ?? null,
      strike_type: m.strike_type ?? null,
      rules_primary: m.rules_primary ?? null,
      rules_secondary: m.rules_secondary ?? null,
      settlement_source_url: m.settlement_source_url ?? null,
      custom_strike: m.custom_strike ?? null,
      underlying: m.underlying ?? null,
      settlement_value: m.settlement_value ?? null,
      cfd_contract_size: m.cfd_contract_size ?? null,
      yes_fee_fp: m.yes_fee_fp ?? null,
      no_fee_fp: m.no_fee_fp ?? null,
      last_price_fp: m.last_price_fp ?? null,
      yes_bid_fp: m.yes_bid_fp ?? null,
      yes_ask_fp: m.yes_ask_fp ?? null,
      no_bid_fp: m.no_bid_fp ?? null,
      no_ask_fp: m.no_ask_fp ?? null,
    }))

    return {
      success: true,
      output: {
        markets,
        cursor: data.cursor ?? null,
      },
    }
  },

  outputs: {
    markets: {
      type: 'array',
      description: 'Array of market objects with all API fields',
      items: {
        type: 'object',
        properties: KALSHI_MARKET_OUTPUT_PROPERTIES,
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for fetching more results',
    },
  },
}
