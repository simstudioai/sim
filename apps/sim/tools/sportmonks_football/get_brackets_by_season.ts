import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import { SPORTMONKS_FOOTBALL_BASE_URL } from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetBracketsBySeasonParams extends SportmonksBaseParams {
  seasonId: string
}

export interface SportmonksGetBracketsBySeasonResponse extends ToolResponse {
  output: {
    brackets: Record<string, unknown> | null
  }
}

export const sportmonksGetBracketsBySeasonTool: ToolConfig<
  SportmonksGetBracketsBySeasonParams,
  SportmonksGetBracketsBySeasonResponse
> = {
  id: 'sportmonks_football_get_brackets_by_season',
  name: 'Get Brackets by Season',
  description:
    'Retrieve the knockout-stage tournament bracket (stages and progression edges) for a season ID',
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
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/seasons/${encodeURIComponent(params.seasonId.trim())}/brackets`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_brackets_by_season')
    }
    return {
      success: true,
      output: {
        brackets: data.data ?? null,
      },
    }
  },

  outputs: {
    brackets: {
      type: 'json',
      description:
        'Bracket object containing stages (fixtures grouped by knockout round) and edges (progression paths between fixtures)',
    },
  },
}
