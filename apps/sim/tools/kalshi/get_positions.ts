import type { ToolConfig } from '@/tools/types'
import type {
  KalshiAuthParams,
  KalshiPaginationParams,
  KalshiPagingInfo,
  KalshiPosition,
} from './types'
import { buildKalshiAuthHeaders, buildKalshiUrl, handleKalshiError } from './types'

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
      description: 'Filter by market ticker',
    },
    eventTicker: {
      type: 'string',
      required: false,
      description: 'Filter by event ticker (max 10 comma-separated)',
    },
    settlementStatus: {
      type: 'string',
      required: false,
      description: 'Filter by settlement status (all, unsettled, settled). Default: unsettled',
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
    },
    paging: {
      type: 'object',
      description: 'Pagination cursor for fetching more results',
    },
  },
}
