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

export interface SportmonksGetPlayerParams extends SportmonksBaseParams {
  playerId: string
}

export interface SportmonksGetPlayerResponse extends ToolResponse {
  output: {
    player: SportmonksPlayer | null
  }
}

export const sportmonksGetPlayerTool: ToolConfig<
  SportmonksGetPlayerParams,
  SportmonksGetPlayerResponse
> = {
  id: 'sportmonks_football_get_player',
  name: 'Get Player by ID',
  description: 'Retrieve a single football player by their ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    playerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the player',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. country;position;teams.team;statistics)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/players/${encodeURIComponent(params.playerId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_player')
    }
    return {
      success: true,
      output: {
        player: data.data ?? null,
      },
    }
  },

  outputs: {
    player: {
      type: 'object',
      description: 'The requested player object',
      properties: SPORTMONKS_PLAYER_PROPERTIES,
    },
  },
}
