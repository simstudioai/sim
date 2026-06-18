import {
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_BOOKMAKER_PROPERTIES,
  SPORTMONKS_ODDS_BASE_URL,
  type SportmonksBookmaker,
} from '@/tools/sportmonks_odds/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetBookmakerParams extends SportmonksBaseParams {
  bookmakerId: string
}

export interface SportmonksGetBookmakerResponse extends ToolResponse {
  output: {
    bookmaker: SportmonksBookmaker | null
  }
}

export const sportmonksOddsGetBookmakerTool: ToolConfig<
  SportmonksGetBookmakerParams,
  SportmonksGetBookmakerResponse
> = {
  id: 'sportmonks_odds_get_bookmaker',
  name: 'Get Bookmaker by ID',
  description: 'Retrieve a single bookmaker by its ID from the Sportmonks Odds API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    bookmakerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the bookmaker',
    },
  },

  request: {
    url: (params) =>
      `${SPORTMONKS_ODDS_BASE_URL}/bookmakers/${encodeURIComponent(params.bookmakerId.trim())}`,
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_bookmaker')
    }
    return {
      success: true,
      output: {
        bookmaker: data.data ?? null,
      },
    }
  },

  outputs: {
    bookmaker: {
      type: 'object',
      description: 'The requested bookmaker object',
      properties: SPORTMONKS_BOOKMAKER_PROPERTIES,
    },
  },
}
