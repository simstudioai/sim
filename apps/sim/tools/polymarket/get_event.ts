import type { PolymarketEvent } from '@/tools/polymarket/types'
import { buildGammaUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetEventParams {
  eventId?: string // Event ID
  slug?: string // Event slug (alternative to ID)
}

export interface PolymarketGetEventResponse {
  success: boolean
  output: {
    event: PolymarketEvent
  }
}

export const polymarketGetEventTool: ToolConfig<
  PolymarketGetEventParams,
  PolymarketGetEventResponse
> = {
  id: 'polymarket_get_event',
  name: 'Get Event from Polymarket',
  description: 'Retrieve details of a specific event by ID or slug',
  version: '1.0.0',

  params: {
    eventId: {
      type: 'string',
      required: false,
      description: 'The event ID (e.g., "12345" or UUID format). Required if slug is not provided.',
      visibility: 'user-or-llm',
    },
    slug: {
      type: 'string',
      required: false,
      description:
        'The event slug (e.g., "2024-presidential-election"). URL-friendly identifier. Required if eventId is not provided.',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      if (params.slug) {
        return buildGammaUrl(`/events/slug/${params.slug}`)
      }
      return buildGammaUrl(`/events/${params.eventId}`)
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_event')
    }

    return {
      success: true,
      output: {
        event: data,
      },
    }
  },

  outputs: {
    event: {
      type: 'object',
      description: 'Event object with details',
      properties: {
        id: { type: 'string', description: 'Event ID' },
        ticker: { type: 'string', description: 'Event ticker' },
        slug: { type: 'string', description: 'Event slug' },
        title: { type: 'string', description: 'Event title' },
        description: { type: 'string', description: 'Event description' },
        startDate: { type: 'string', description: 'Start date' },
        creationDate: { type: 'string', description: 'Creation date' },
        endDate: { type: 'string', description: 'End date' },
        image: { type: 'string', description: 'Event image URL' },
        icon: { type: 'string', description: 'Event icon URL' },
        active: { type: 'boolean', description: 'Whether event is active' },
        closed: { type: 'boolean', description: 'Whether event is closed' },
        archived: { type: 'boolean', description: 'Whether event is archived' },
        liquidity: { type: 'number', description: 'Total liquidity' },
        volume: { type: 'number', description: 'Total volume' },
        openInterest: { type: 'number', description: 'Open interest' },
        commentCount: { type: 'number', description: 'Comment count' },
        markets: { type: 'array', description: 'Array of markets in this event' },
      },
    },
  },
}
