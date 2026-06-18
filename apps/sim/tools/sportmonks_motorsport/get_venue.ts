import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_VENUE_PROPERTIES,
  type SportmonksMsVenue,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetVenueParams extends SportmonksBaseParams {
  venueId: string
}

export interface SportmonksMsGetVenueResponse extends ToolResponse {
  output: {
    venue: SportmonksMsVenue | null
  }
}

export const sportmonksMotorsportGetVenueTool: ToolConfig<
  SportmonksMsGetVenueParams,
  SportmonksMsGetVenueResponse
> = {
  id: 'sportmonks_motorsport_get_venue',
  name: 'Get Venue by ID',
  description: 'Retrieve a single motorsport venue (racing track) by its ID from Sportmonks',
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
      description: 'The unique id of the venue (track)',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. country;city)',
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
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/venues/${encodeURIComponent(params.venueId.trim())}`
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
      description: 'The requested venue (racing track) object',
      properties: SPORTMONKS_MS_VENUE_PROPERTIES,
    },
  },
}
