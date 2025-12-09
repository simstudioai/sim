import type { ToolConfig } from '@/tools/types'
import type { KalshiEvent, KalshiPaginationParams, KalshiPagingInfo } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetEventsParams extends KalshiPaginationParams {
  status?: string // open, closed, settled
  seriesTicker?: string
  withNestedMarkets?: string // 'true' or 'false'
}

export interface KalshiGetEventsResponse {
  success: boolean
  output: {
    events: KalshiEvent[]
    paging?: KalshiPagingInfo
  }
}

export const kalshiGetEventsTool: ToolConfig<KalshiGetEventsParams, KalshiGetEventsResponse> = {
  id: 'kalshi_get_events',
  name: 'Get Events from Kalshi',
  description: 'Retrieve a list of events from Kalshi with optional filtering',
  version: '1.0.0',

  params: {
    status: {
      type: 'string',
      required: false,
      description: 'Filter by status (open, closed, settled)',
    },
    seriesTicker: {
      type: 'string',
      required: false,
      description: 'Filter by series ticker',
    },
    withNestedMarkets: {
      type: 'string',
      required: false,
      description: 'Include nested markets in response (true/false)',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results (1-200, default: 200)',
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
      if (params.withNestedMarkets)
        queryParams.append('with_nested_markets', params.withNestedMarkets)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/events')
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
      handleKalshiError(data, response.status, 'get_events')
    }

    const events = data.events || []

    return {
      success: true,
      output: {
        events,
        paging: {
          cursor: data.cursor || null,
        },
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'Array of event objects',
    },
    paging: {
      type: 'object',
      description: 'Pagination cursor for fetching more results',
    },
  },
}
