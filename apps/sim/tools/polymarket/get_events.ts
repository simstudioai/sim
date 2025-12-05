import type { ToolConfig } from '@/tools/types'
import type { PolymarketEvent, PolymarketPaginationParams } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

export interface PolymarketGetEventsParams extends PolymarketPaginationParams {
  closed?: string // 'true' or 'false' - filter for closed/active events
  order?: string // sort field
  ascending?: string // 'true' or 'false' - sort direction
  tagId?: string // filter by tag ID
}

export interface PolymarketGetEventsResponse {
  success: boolean
  output: {
    events: PolymarketEvent[]
    metadata: {
      operation: 'get_events'
      totalReturned: number
    }
    success: boolean
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
      description: 'Sort field (e.g., id, volume)',
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
      if (params.closed) queryParams.append('closed', params.closed)
      if (params.order) queryParams.append('order', params.order)
      if (params.ascending) queryParams.append('ascending', params.ascending)
      if (params.tagId) queryParams.append('tag_id', params.tagId)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildGammaUrl('/events')
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
      handlePolymarketError(data, response.status, 'get_events')
    }

    // Response is an array of events
    const events = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        events,
        metadata: {
          operation: 'get_events' as const,
          totalReturned: events.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Events data and metadata',
      properties: {
        events: { type: 'array', description: 'Array of event objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
