import type { ToolConfig } from '@/tools/types'
import type { PolymarketPaginationParams, PolymarketSeries } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

export interface PolymarketGetSeriesParams extends PolymarketPaginationParams {}

export interface PolymarketGetSeriesResponse {
  success: boolean
  output: {
    series: PolymarketSeries[]
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
      description: 'Number of results per page (max 50)',
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
      // Default limit to 50 to prevent browser crashes from large data sets
      queryParams.append('limit', params.limit || '50')
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildGammaUrl('/series')
      return `${url}?${query}`
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

    // Response is an array of series - each series can contain thousands of nested events
    // Strip the events array to prevent browser crashes (use get_events to fetch events separately)
    const series = Array.isArray(data)
      ? data.map((s: any) => ({
          id: s.id,
          ticker: s.ticker,
          slug: s.slug,
          title: s.title,
          seriesType: s.seriesType,
          recurrence: s.recurrence,
          image: s.image,
          icon: s.icon,
          active: s.active,
          closed: s.closed,
          archived: s.archived,
          featured: s.featured,
          restricted: s.restricted,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          volume: s.volume,
          liquidity: s.liquidity,
          commentCount: s.commentCount,
          eventCount: s.events?.length || 0, // Include count instead of full array
        }))
      : []

    return {
      success: true,
      output: {
        series,
      },
    }
  },

  outputs: {
    series: {
      type: 'array',
      description: 'Array of series objects',
    },
  },
}
