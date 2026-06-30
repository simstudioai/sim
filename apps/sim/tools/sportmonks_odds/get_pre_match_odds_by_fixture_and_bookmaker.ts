import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_ODDS_BASE_URL,
  SPORTMONKS_ODD_PROPERTIES,
  type SportmonksOdd,
} from '@/tools/sportmonks_odds/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetPreMatchOddsByFixtureAndBookmakerParams extends SportmonksBaseParams {
  fixtureId: string
  bookmakerId: string
}

export interface SportmonksGetPreMatchOddsByFixtureAndBookmakerResponse extends ToolResponse {
  output: {
    odds: SportmonksOdd[]
  }
}

export const sportmonksOddsGetPreMatchOddsByFixtureAndBookmakerTool: ToolConfig<
  SportmonksGetPreMatchOddsByFixtureAndBookmakerParams,
  SportmonksGetPreMatchOddsByFixtureAndBookmakerResponse
> = {
  id: 'sportmonks_odds_get_pre_match_odds_by_fixture_and_bookmaker',
  name: 'Get Pre-match Odds by Fixture and Bookmaker',
  description:
    'Retrieve pre-match odds for a fixture from a specific bookmaker via the Sportmonks Odds API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    fixtureId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the fixture',
    },
    bookmakerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the bookmaker',
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
      description: 'Filters to apply (e.g. markets:1,12 or winningOdds)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_ODDS_BASE_URL}/pre-match/fixtures/${encodeURIComponent(params.fixtureId.trim())}/bookmakers/${encodeURIComponent(params.bookmakerId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_pre_match_odds_by_fixture_and_bookmaker')
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
      description: 'Array of pre-match odd objects for the fixture and bookmaker',
      items: { type: 'object', properties: SPORTMONKS_ODD_PROPERTIES },
    },
  },
}
