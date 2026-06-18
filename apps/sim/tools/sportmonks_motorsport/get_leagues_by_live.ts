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
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_LEAGUE_PROPERTIES,
  type SportmonksMsLeague,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetLeaguesByLiveParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksMsGetLeaguesByLiveResponse extends ToolResponse {
  output: {
    leagues: SportmonksMsLeague[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksMotorsportGetLeaguesByLiveTool: ToolConfig<
  SportmonksMsGetLeaguesByLiveParams,
  SportmonksMsGetLeaguesByLiveResponse
> = {
  id: 'sportmonks_motorsport_get_leagues_by_live',
  name: 'Get Leagues by Live',
  description: 'Retrieve all motorsport leagues that currently have live fixtures from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. country;seasons)',
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
      description: 'Order direction (asc or desc)',
    },
  },

  request: {
    url: (params) =>
      appendSportmonksQuery(`${SPORTMONKS_MOTORSPORT_BASE_URL}/leagues/live`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_leagues_by_live')
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
      description: 'Array of league objects that currently have live fixtures',
      items: { type: 'object', properties: SPORTMONKS_MS_LEAGUE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
