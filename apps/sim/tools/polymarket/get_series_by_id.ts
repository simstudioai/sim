import type { PolymarketSeries } from '@/tools/polymarket/types'
import { buildGammaUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetSeriesByIdParams {
  seriesId: string // Series ID (required)
}

export interface PolymarketGetSeriesByIdResponse {
  success: boolean
  output: {
    series: PolymarketSeries
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
      description: 'The series ID (e.g., "12345" or UUID format).',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => buildGammaUrl(`/series/${params.seriesId}`),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_series_by_id')
    }

    return {
      success: true,
      output: {
        series: data,
      },
    }
  },

  outputs: {
    series: {
      type: 'object',
      description: 'Series object with details',
      properties: {
        id: { type: 'string', description: 'Series ID' },
        ticker: { type: 'string', description: 'Series ticker' },
        slug: { type: 'string', description: 'Series slug' },
        title: { type: 'string', description: 'Series title' },
        seriesType: { type: 'string', description: 'Series type' },
        recurrence: { type: 'string', description: 'Recurrence pattern' },
        image: { type: 'string', description: 'Series image URL' },
        icon: { type: 'string', description: 'Series icon URL' },
        active: { type: 'boolean', description: 'Whether series is active' },
        closed: { type: 'boolean', description: 'Whether series is closed' },
        archived: { type: 'boolean', description: 'Whether series is archived' },
        featured: { type: 'boolean', description: 'Whether series is featured' },
        volume: { type: 'number', description: 'Total volume' },
        liquidity: { type: 'number', description: 'Total liquidity' },
        commentCount: { type: 'number', description: 'Comment count' },
        eventCount: { type: 'number', description: 'Number of events in series' },
        events: { type: 'array', description: 'Array of events in this series' },
      },
    },
  },
}
