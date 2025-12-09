import type { ToolConfig } from '@/tools/types'
import type { PolymarketEvent } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

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
      description: 'The event ID. Required if slug is not provided.',
    },
    slug: {
      type: 'string',
      required: false,
      description:
        'The event slug (e.g., "2024-presidential-election"). Required if eventId is not provided.',
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
    },
  },
}
