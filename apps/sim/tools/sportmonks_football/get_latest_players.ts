import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_PLAYER_PROPERTIES,
  type SportmonksPlayer,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetLatestPlayersParams extends SportmonksBaseParams {}

export interface SportmonksGetLatestPlayersResponse extends ToolResponse {
  output: {
    players: SportmonksPlayer[]
  }
}

export const sportmonksGetLatestPlayersTool: ToolConfig<
  SportmonksGetLatestPlayersParams,
  SportmonksGetLatestPlayersResponse
> = {
  id: 'sportmonks_football_get_latest_players',
  name: 'Get Last Updated Players',
  description: 'Retrieve all players that have received updates in the past two hours',
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
      description:
        'Semicolon-separated relations to enrich the response (e.g. nationality;position)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply',
    },
  },

  request: {
    url: (params) =>
      appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/players/latest`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_latest_players')
    }
    return {
      success: true,
      output: {
        players: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    players: {
      type: 'array',
      description: 'Array of recently updated player objects',
      items: { type: 'object', properties: SPORTMONKS_PLAYER_PROPERTIES },
    },
  },
}
