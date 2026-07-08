import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_TOTW_PROPERTIES,
  type SportmonksTotw,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetLatestTotwParams extends SportmonksBaseParams {
  leagueId: string
}

export interface SportmonksGetLatestTotwResponse extends ToolResponse {
  output: {
    totw: SportmonksTotw[]
  }
}

export const sportmonksGetLatestTotwTool: ToolConfig<
  SportmonksGetLatestTotwParams,
  SportmonksGetLatestTotwResponse
> = {
  id: 'sportmonks_football_get_latest_totw',
  name: 'Get Latest Team of the Week',
  description: 'Retrieve the latest Team of the Week (TOTW) for a league ID from Sportmonks',
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
        'Semicolon-separated relations to enrich the response (e.g. fixture;team;player;round)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/team-of-the-week/leagues/${encodeURIComponent(params.leagueId.trim())}/latest`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_latest_totw')
    }
    return {
      success: true,
      output: {
        totw: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    totw: {
      type: 'array',
      description: 'Array of the latest Team of the Week entries for the league',
      items: { type: 'object', properties: SPORTMONKS_TOTW_PROPERTIES },
    },
  },
}
