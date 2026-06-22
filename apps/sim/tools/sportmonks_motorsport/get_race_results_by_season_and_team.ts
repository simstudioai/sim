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
  SPORTMONKS_MS_STAGE_PROPERTIES,
  type SportmonksMsStage,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetRaceResultsBySeasonAndTeamParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  seasonId: string
  teamId: string
}

export interface SportmonksMsGetRaceResultsBySeasonAndTeamResponse extends ToolResponse {
  output: {
    results: SportmonksMsStage[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksMotorsportGetRaceResultsBySeasonAndTeamTool: ToolConfig<
  SportmonksMsGetRaceResultsBySeasonAndTeamParams,
  SportmonksMsGetRaceResultsBySeasonAndTeamResponse
> = {
  id: 'sportmonks_motorsport_get_race_results_by_season_and_team',
  name: 'Get Race Results by Season and Team',
  description:
    'Retrieve race results (stages with fixtures, lineups and lineup details) for a season and team from Sportmonks',
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
    teamId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the team (constructor)',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response',
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
    url: (params) => {
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/results/seasons/${encodeURIComponent(params.seasonId.trim())}/teams/${encodeURIComponent(params.teamId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_race_results_by_season_and_team')
    }
    return {
      success: true,
      output: {
        results: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description:
        'Array of stage objects for the season and team, each including nested fixtures, lineups and lineup details',
      items: { type: 'object', properties: SPORTMONKS_MS_STAGE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
