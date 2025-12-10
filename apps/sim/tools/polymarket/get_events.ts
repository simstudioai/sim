import type { ToolConfig } from '@/tools/types'
import type { PolymarketEvent, PolymarketPaginationParams } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

export interface PolymarketGetEventsParams extends PolymarketPaginationParams {
  closed?: string // 'true' or 'false' - filter for closed/active events
  order?: string // sort field (e.g., 'volume', 'liquidity', 'startDate', 'endDate')
  ascending?: string // 'true' or 'false' - sort direction
  tagId?: string // filter by tag ID
}

export interface PolymarketGetEventsResponse {
  success: boolean
  output: {
    events: PolymarketEvent[]
  }
}

export const polymarketGetEventsTool: ToolConfig<
  PolymarketGetEventsParams,
  PolymarketGetEventsResponse
> = {
  id: 'polymarket_get_events',
  name: 'Get Events from Polymarket',
  description: 'Retrieve a list of events from Polymarket with optional filtering',
  version: '1.0.0',

  params: {
    closed: {
      type: 'string',
      required: false,
      description: 'Filter by closed status (true/false). Use false for active events only.',
    },
    order: {
      type: 'string',
      required: false,
      description: 'Sort field (e.g., volume, liquidity, startDate, endDate, createdAt)',
    },
    ascending: {
      type: 'string',
      required: false,
      description: 'Sort direction (true for ascending, false for descending)',
    },
    tagId: {
      type: 'string',
      required: false,
      description: 'Filter by tag ID',
    },
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
      if (params.closed) queryParams.append('closed', params.closed)
      if (params.order) queryParams.append('order', params.order)
      if (params.ascending) queryParams.append('ascending', params.ascending)
      if (params.tagId) queryParams.append('tag_id', params.tagId)
      // Default limit to 50 to prevent browser crashes from large data sets
      queryParams.append('limit', params.limit || '50')
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildGammaUrl('/events')
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
      handlePolymarketError(data, response.status, 'get_events')
    }

    // Response is an array of events
    const events = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        events,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'Array of event objects',
    },
  },
}
