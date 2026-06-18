import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_LEAGUE_PROPERTIES,
  type SportmonksMsLeague,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetLeagueParams extends SportmonksBaseParams {
  leagueId: string
}

export interface SportmonksMsGetLeagueResponse extends ToolResponse {
  output: {
    league: SportmonksMsLeague | null
  }
}

export const sportmonksMotorsportGetLeagueTool: ToolConfig<
  SportmonksMsGetLeagueParams,
  SportmonksMsGetLeagueResponse
> = {
  id: 'sportmonks_motorsport_get_league',
  name: 'Get League by ID',
  description: 'Retrieve a single motorsport league by its ID from Sportmonks',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. country;seasons)',
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
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/leagues/${encodeURIComponent(params.leagueId.trim())}`
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
      properties: SPORTMONKS_MS_LEAGUE_PROPERTIES,
    },
  },
}
