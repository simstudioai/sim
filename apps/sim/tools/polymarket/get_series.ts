import type { ToolConfig } from '@/tools/types'
import type { PolymarketPaginationParams, PolymarketSeries } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

export interface PolymarketGetSeriesParams extends PolymarketPaginationParams {}

export interface PolymarketGetSeriesResponse {
  success: boolean
  output: {
    series: PolymarketSeries[]
    metadata: {
      operation: 'get_series'
      totalReturned: number
    }
    success: boolean
  }
}

export const polymarketGetSeriesTool: ToolConfig<
  PolymarketGetSeriesParams,
  PolymarketGetSeriesResponse
> = {
  id: 'polymarket_get_series',
  name: 'Get Series from Polymarket',
  description: 'Retrieve series (related market groups) from Polymarket',
  version: '1.0.0',

  params: {
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results per page (recommended: 25-50)',
    },
    offset: {
      type: 'string',
      required: false,
      description: 'Pagination offset (skip this many results)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildGammaUrl('/series')
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
      handlePolymarketError(data, response.status, 'get_series')
    }

    // Response is an array of series
    const series = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        series,
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
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
