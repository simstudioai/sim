import type { ToolConfig } from '@/tools/types'
import type { PolymarketSeries } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

export interface PolymarketGetSeriesByIdParams {
  seriesId: string // Series ID (required)
}

export interface PolymarketGetSeriesByIdResponse {
  success: boolean
  output: {
    series: PolymarketSeries
    metadata: {
      operation: 'get_series_by_id'
      seriesId: string
    }
    success: boolean
  }
}

export const polymarketGetSeriesByIdTool: ToolConfig<
  PolymarketGetSeriesByIdParams,
  PolymarketGetSeriesByIdResponse
> = {
  id: 'polymarket_get_series_by_id',
  name: 'Get Series by ID from Polymarket',
  description: 'Retrieve a specific series (related market group) by ID from Polymarket',
  version: '1.0.0',

  params: {
    seriesId: {
      type: 'string',
      required: true,
      description: 'The series ID',
    },
  },

  request: {
    url: (params) => buildGammaUrl(`/series/${params.seriesId}`),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_series_by_id')
    }

    return {
      success: true,
      output: {
        series: data,
        metadata: {
          operation: 'get_series_by_id' as const,
          seriesId: params?.seriesId || '',
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
        series: { type: 'object', description: 'Series object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
