import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_LEAGUE_PROPERTIES,
  type SportmonksLeague,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetLeagueParams extends SportmonksBaseParams {
  leagueId: string
}

export interface SportmonksGetLeagueResponse extends ToolResponse {
  output: {
    league: SportmonksLeague | null
  }
}

export const sportmonksGetLeagueTool: ToolConfig<
  SportmonksGetLeagueParams,
  SportmonksGetLeagueResponse
> = {
  id: 'sportmonks_football_get_league',
  name: 'Get League by ID',
  description: 'Retrieve a single football league by its ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    leagueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the league',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. country;currentSeason;seasons)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/leagues/${encodeURIComponent(params.leagueId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_league')
    }
    return {
      success: true,
      output: {
        league: data.data ?? null,
      },
    }
  },

  outputs: {
    league: {
      type: 'object',
      description: 'The requested league object',
      properties: SPORTMONKS_LEAGUE_PROPERTIES,
    },
  },
}
