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

export interface SportmonksGetInplayOddsByFixtureAndMarketParams extends SportmonksBaseParams {
  fixtureId: string
  marketId: string
}

export interface SportmonksGetInplayOddsByFixtureAndMarketResponse extends ToolResponse {
  output: {
    odds: SportmonksInplayOdd[]
  }
}

export const sportmonksOddsGetInplayOddsByFixtureAndMarketTool: ToolConfig<
  SportmonksGetInplayOddsByFixtureAndMarketParams,
  SportmonksGetInplayOddsByFixtureAndMarketResponse
> = {
  id: 'sportmonks_odds_get_inplay_odds_by_fixture_and_market',
  name: 'Get In-play Odds by Fixture and Market',
  description:
    'Retrieve live (in-play) odds for a fixture on a specific market via the Sportmonks Odds API',
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
    marketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the market',
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
      description: 'Filters to apply (e.g. bookmakers:2,14)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_ODDS_BASE_URL}/inplay/fixtures/${encodeURIComponent(params.fixtureId.trim())}/markets/${encodeURIComponent(params.marketId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_inplay_odds_by_fixture_and_market')
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
      description: 'Array of in-play odd objects for the fixture and market',
      items: { type: 'object', properties: SPORTMONKS_INPLAY_ODD_PROPERTIES },
    },
  },
}
