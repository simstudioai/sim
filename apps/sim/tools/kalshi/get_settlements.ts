import type {
  KalshiAuthParams,
  KalshiPaginationParams,
  KalshiPagingInfo,
} from '@/tools/kalshi/types'
import {
  buildKalshiAuthHeaders,
  buildKalshiUrl,
  handleKalshiError,
  KALSHI_SETTLEMENT_OUTPUT_PROPERTIES,
} from '@/tools/kalshi/types'
import type { ToolConfig } from '@/tools/types'

export interface KalshiGetSettlementsParams extends KalshiAuthParams, KalshiPaginationParams {
  ticker?: string
  eventTicker?: string
  minTs?: number
  maxTs?: number
}

export interface KalshiGetSettlementsResponse {
  success: boolean
  output: {
    settlements: Array<Record<string, unknown>>
    paging?: KalshiPagingInfo
  }
}

export const kalshiGetSettlementsTool: ToolConfig<
  KalshiGetSettlementsParams,
  KalshiGetSettlementsResponse
> = {
  id: 'kalshi_get_settlements',
  name: 'Get Settlements from Kalshi',
  description: 'Retrieve your portfolio settlement history from Kalshi',
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
      description: 'Filter by event ticker (e.g., "KXBTC-24DEC31")',
    },
    minTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum settled timestamp in Unix seconds (e.g., 1704067200)',
    },
    maxTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum settled timestamp in Unix seconds (e.g., 1704153600)',
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
      if (params.minTs !== undefined) queryParams.append('min_ts', params.minTs.toString())
      if (params.maxTs !== undefined) queryParams.append('max_ts', params.maxTs.toString())
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/portfolio/settlements')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => {
      const path = '/trade-api/v2/portfolio/settlements'
      return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'GET', path)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_settlements')
    }

    return {
      success: true,
      output: {
        settlements: data.settlements || [],
        paging: {
          cursor: data.cursor || null,
        },
      },
    }
  },

  outputs: {
    settlements: {
      type: 'array',
      description: 'Array of settlement objects',
      items: {
        type: 'object',
        properties: KALSHI_SETTLEMENT_OUTPUT_PROPERTIES,
      },
    },
    paging: {
      type: 'object',
      description: 'Pagination cursor for fetching more results',
    },
  },
}

/**
 * V2 Params for Get Settlements - adds subaccount and exact response mapping
 */
export interface KalshiGetSettlementsV2Params extends KalshiAuthParams, KalshiPaginationParams {
  ticker?: string
  eventTicker?: string
  minTs?: number
  maxTs?: number
  subaccount?: string
}

/**
 * V2 Response matching Kalshi API exactly
 */
export interface KalshiGetSettlementsV2Response {
  success: boolean
  output: {
    settlements: Array<{
      ticker: string
      event_ticker: string
      market_result: string | null
      yes_count_fp: string | null
      yes_total_cost_dollars: string | null
      no_count_fp: string | null
      no_total_cost_dollars: string | null
      revenue: number | null
      settled_time: string | null
      fee_cost: string | null
      value: number | null
    }>
    cursor: string | null
  }
}

export const kalshiGetSettlementsV2Tool: ToolConfig<
  KalshiGetSettlementsV2Params,
  KalshiGetSettlementsV2Response
> = {
  id: 'kalshi_get_settlements_v2',
  name: 'Get Settlements from Kalshi V2',
  description: 'Retrieve your portfolio settlement history from Kalshi (V2 - exact API response)',
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
      description: 'Filter by event ticker (e.g., "KXBTC-24DEC31")',
    },
    minTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum settled timestamp in Unix seconds (e.g., 1704067200)',
    },
    maxTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum settled timestamp in Unix seconds (e.g., 1704153600)',
    },
    subaccount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subaccount number (0 for primary, 1-63 for subaccounts)',
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
      if (params.minTs !== undefined) queryParams.append('min_ts', params.minTs.toString())
      if (params.maxTs !== undefined) queryParams.append('max_ts', params.maxTs.toString())
      if (params.subaccount) queryParams.append('subaccount', params.subaccount)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/portfolio/settlements')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => {
      const path = '/trade-api/v2/portfolio/settlements'
      return buildKalshiAuthHeaders(params.keyId, params.privateKey, 'GET', path)
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_settlements_v2')
    }

    const settlements = (data.settlements || []).map((s: Record<string, unknown>) => ({
      ticker: s.ticker ?? null,
      event_ticker: s.event_ticker ?? null,
      market_result: s.market_result ?? null,
      yes_count_fp: s.yes_count_fp ?? null,
      yes_total_cost_dollars: s.yes_total_cost_dollars ?? null,
      no_count_fp: s.no_count_fp ?? null,
      no_total_cost_dollars: s.no_total_cost_dollars ?? null,
      revenue: s.revenue ?? null,
      settled_time: s.settled_time ?? null,
      fee_cost: s.fee_cost ?? null,
      value: s.value ?? null,
    }))

    return {
      success: true,
      output: {
        settlements,
        cursor: data.cursor ?? null,
      },
    }
  },

  outputs: {
    settlements: {
      type: 'array',
      description: 'Array of settlement objects with all API fields',
      items: {
        type: 'object',
        properties: KALSHI_SETTLEMENT_OUTPUT_PROPERTIES,
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for fetching more results',
    },
  },
}
