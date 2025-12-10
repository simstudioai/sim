import type { ToolConfig } from '@/tools/types'
import type { KalshiMarket, KalshiPaginationParams, KalshiPagingInfo } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

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
      description: 'Filter by status (unopened, open, closed, settled)',
    },
    seriesTicker: {
      type: 'string',
      required: false,
      description: 'Filter by series ticker',
    },
    eventTicker: {
      type: 'string',
      required: false,
      description: 'Filter by event ticker',
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
    },
    paging: {
      type: 'object',
      description: 'Pagination cursor for fetching more results',
    },
  },
}
