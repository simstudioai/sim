import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_STANDING_PROPERTIES,
  type SportmonksStanding,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetLiveStandingsByLeagueParams extends SportmonksBaseParams {
  leagueId: string
}

export interface SportmonksGetLiveStandingsByLeagueResponse extends ToolResponse {
  output: {
    standings: SportmonksStanding[]
  }
}

export const sportmonksGetLiveStandingsByLeagueTool: ToolConfig<
  SportmonksGetLiveStandingsByLeagueParams,
  SportmonksGetLiveStandingsByLeagueResponse
> = {
  id: 'sportmonks_football_get_live_standings_by_league',
  name: 'Get Live Standings by League',
  description: 'Retrieve the live standing table for a league ID from Sportmonks',
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
        'Semicolon-separated relations to enrich the response (e.g. participant;details)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. standingGroups:246697)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/standings/live/leagues/${encodeURIComponent(params.leagueId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_live_standings_by_league')
    }
    return {
      success: true,
      output: {
        standings: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    standings: {
      type: 'array',
      description: 'Array of live standing entries for the league',
      items: { type: 'object', properties: SPORTMONKS_STANDING_PROPERTIES },
    },
  },
}
