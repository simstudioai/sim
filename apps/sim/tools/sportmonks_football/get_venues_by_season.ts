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

export interface SportmonksGetVenuesBySeasonParams extends SportmonksBaseParams {
  seasonId: string
}

export interface SportmonksGetVenuesBySeasonResponse extends ToolResponse {
  output: {
    venues: SportmonksVenue[]
  }
}

export const sportmonksGetVenuesBySeasonTool: ToolConfig<
  SportmonksGetVenuesBySeasonParams,
  SportmonksGetVenuesBySeasonResponse
> = {
  id: 'sportmonks_football_get_venues_by_season',
  name: 'Get Venues by Season',
  description: 'Retrieve all venues for a season ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    seasonId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the season',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/venues/seasons/${encodeURIComponent(params.seasonId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_venues_by_season')
    }
    return {
      success: true,
      output: {
        venues: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    venues: {
      type: 'array',
      description: 'Array of venue objects for the season',
      items: { type: 'object', properties: SPORTMONKS_VENUE_PROPERTIES },
    },
  },
}
