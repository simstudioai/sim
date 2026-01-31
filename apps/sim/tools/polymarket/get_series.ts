import type { PolymarketPaginationParams, PolymarketSeries } from '@/tools/polymarket/types'
import { buildGammaUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

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
      description: 'Number of results per page (e.g., "25"). Max: 50.',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'string',
      required: false,
      description: 'Number of results to skip for pagination (e.g., "50").',
      visibility: 'user-or-llm',
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
      items: {
        type: 'object',
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
          eventCount: { type: 'number', description: 'Number of events in series' },
        },
      },
    },
  },
}
