import type { ToolConfig } from '@/tools/types'
import type { KalshiPaginationParams, KalshiPagingInfo, KalshiSeries } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetSeriesParams extends KalshiPaginationParams {
  status?: string
}

export interface KalshiGetSeriesResponse {
  success: boolean
  output: {
    series: KalshiSeries[]
    paging?: KalshiPagingInfo
    metadata: {
      operation: 'get_series'
      totalReturned: number
    }
    success: boolean
  }
}

export const kalshiGetSeriesTool: ToolConfig<KalshiGetSeriesParams, KalshiGetSeriesResponse> = {
  id: 'kalshi_get_series',
  name: 'Get Series from Kalshi',
  description: 'Retrieve a list of market series templates from Kalshi',
  version: '1.0.0',

  params: {
    status: {
      type: 'string',
      required: false,
      description: 'Filter by status',
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
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/series')
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
      handleKalshiError(data, response.status, 'get_series')
    }

    const series = data.series || []

    return {
      success: true,
      output: {
        series,
        paging: {
          cursor: data.cursor || null,
        },
        metadata: {
          operation: 'get_series' as const,
          totalReturned: series.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Series data and metadata',
      properties: {
        series: { type: 'array', description: 'Array of series objects' },
        paging: { type: 'object', description: 'Pagination information' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
