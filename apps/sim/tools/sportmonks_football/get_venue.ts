import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_VENUE_PROPERTIES,
  type SportmonksVenue,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetVenueParams extends SportmonksBaseParams {
  venueId: string
}

export interface SportmonksGetVenueResponse extends ToolResponse {
  output: {
    venue: SportmonksVenue | null
  }
}

export const sportmonksGetVenueTool: ToolConfig<
  SportmonksGetVenueParams,
  SportmonksGetVenueResponse
> = {
  id: 'sportmonks_football_get_venue',
  name: 'Get Venue by ID',
  description: 'Retrieve a single football venue by its ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    venueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the venue',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. country;city;fixtures)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/venues/${encodeURIComponent(params.venueId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_venue')
    }
    return {
      success: true,
      output: {
        venue: data.data ?? null,
      },
    }
  },

  outputs: {
    venue: {
      type: 'object',
      description: 'The requested venue object',
      properties: SPORTMONKS_VENUE_PROPERTIES,
    },
  },
}
