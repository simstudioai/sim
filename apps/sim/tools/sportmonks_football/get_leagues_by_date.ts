import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  SPORTMONKS_PAGINATION_OUTPUT,
  type SportmonksBaseParams,
  type SportmonksPagination,
  type SportmonksPaginationParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_LEAGUE_PROPERTIES,
  type SportmonksLeague,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetLeaguesByDateParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  date: string
}

export interface SportmonksGetLeaguesByDateResponse extends ToolResponse {
  output: {
    leagues: SportmonksLeague[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetLeaguesByDateTool: ToolConfig<
  SportmonksGetLeaguesByDateParams,
  SportmonksGetLeaguesByDateResponse
> = {
  id: 'sportmonks_football_get_leagues_by_date',
  name: 'Get Leagues by Date',
  description: 'Retrieve all leagues with fixtures on a given date (YYYY-MM-DD) from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    date: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The fixture date in YYYY-MM-DD format',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. country;currentSeason)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply',
    },
    per_page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 50, default 25)',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number to retrieve',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order leagues (asc or desc)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/leagues/date/${encodeURIComponent(params.date.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_leagues_by_date')
    }
    return {
      success: true,
      output: {
        leagues: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    leagues: {
      type: 'array',
      description: 'Array of league objects with fixtures on the requested date',
      items: { type: 'object', properties: SPORTMONKS_LEAGUE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
