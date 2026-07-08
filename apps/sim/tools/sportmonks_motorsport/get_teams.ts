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
  SPORTMONKS_MS_TEAM_PROPERTIES,
  type SportmonksMsTeam,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetTeamsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksMsGetTeamsResponse extends ToolResponse {
  output: {
    teams: SportmonksMsTeam[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksMotorsportGetTeamsTool: ToolConfig<
  SportmonksMsGetTeamsParams,
  SportmonksMsGetTeamsResponse
> = {
  id: 'sportmonks_motorsport_get_teams',
  name: 'Get Teams',
  description: 'Retrieve all motorsport teams (constructors) from Sportmonks',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. country;drivers)',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_MOTORSPORT_BASE_URL}/teams`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_teams')
    }
    return {
      success: true,
      output: {
        teams: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    teams: {
      type: 'array',
      description: 'Array of team (constructor) objects',
      items: { type: 'object', properties: SPORTMONKS_MS_TEAM_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
