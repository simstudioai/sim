import type { PolymarketEvent, PolymarketPaginationParams } from '@/tools/polymarket/types'
import { buildGammaUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetEventsParams extends PolymarketPaginationParams {
  closed?: string
  order?: string
  ascending?: string
  tagId?: string
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
      description: 'Filter by closed status (true/false). Use false for open events only.',
      visibility: 'user-or-llm',
    },
    order: {
      type: 'string',
      required: false,
      description: 'Sort field (e.g., volume, liquidity, startDate, endDate, createdAt)',
      visibility: 'user-or-llm',
    },
    ascending: {
      type: 'string',
      required: false,
      description: 'Sort direction (true for ascending, false for descending)',
      visibility: 'user-or-llm',
    },
    tagId: {
      type: 'string',
      required: false,
      description: 'Filter by tag ID',
      visibility: 'user-or-llm',
    },
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
      if (params.closed) queryParams.append('closed', params.closed)
      if (params.order) queryParams.append('order', params.order)
      if (params.ascending) queryParams.append('ascending', params.ascending)
      if (params.tagId) queryParams.append('tag_id', params.tagId)
      queryParams.append('limit', params.limit || '50')
      if (params.offset) queryParams.append('offset', params.offset)

      const url = buildGammaUrl('/events')
      return `${url}?${queryParams.toString()}`
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
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Event ID' },
          ticker: { type: 'string', description: 'Event ticker' },
          slug: { type: 'string', description: 'Event slug' },
          title: { type: 'string', description: 'Event title' },
          description: { type: 'string', description: 'Event description' },
          startDate: { type: 'string', description: 'Start date' },
          endDate: { type: 'string', description: 'End date' },
          image: { type: 'string', description: 'Event image URL' },
          icon: { type: 'string', description: 'Event icon URL' },
          active: { type: 'boolean', description: 'Whether event is active' },
          closed: { type: 'boolean', description: 'Whether event is closed' },
          archived: { type: 'boolean', description: 'Whether event is archived' },
          liquidity: { type: 'number', description: 'Total liquidity' },
          volume: { type: 'number', description: 'Total volume' },
          markets: { type: 'array', description: 'Array of markets in this event' },
        },
      },
    },
  },
}
