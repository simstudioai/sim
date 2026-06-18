import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_ODDS_BASE_URL,
  SPORTMONKS_INPLAY_ODD_PROPERTIES,
  type SportmonksInplayOdd,
} from '@/tools/sportmonks_odds/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetLastUpdatedInplayOddsParams extends SportmonksBaseParams {}

export interface SportmonksGetLastUpdatedInplayOddsResponse extends ToolResponse {
  output: {
    odds: SportmonksInplayOdd[]
  }
}

export const sportmonksOddsGetLastUpdatedInplayOddsTool: ToolConfig<
  SportmonksGetLastUpdatedInplayOddsParams,
  SportmonksGetLastUpdatedInplayOddsResponse
> = {
  id: 'sportmonks_odds_get_last_updated_inplay_odds',
  name: 'Get Last Updated In-play Odds',
  description: 'Retrieve in-play odds updated in the last 10 seconds from the Sportmonks Odds API',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. market;bookmaker)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. markets:1,12 or bookmakers:2,14)',
    },
  },

  request: {
    url: (params) =>
      appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_ODDS_BASE_URL}/inplay/latest`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_last_updated_inplay_odds')
    }
    return {
      success: true,
      output: {
        odds: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    odds: {
      type: 'array',
      description: 'Array of in-play odd objects updated in the last 10 seconds',
      items: { type: 'object', properties: SPORTMONKS_INPLAY_ODD_PROPERTIES },
    },
  },
}
