import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_ODDS_BASE_URL,
  SPORTMONKS_PREMIUM_ODD_PROPERTIES,
  type SportmonksPremiumOdd,
} from '@/tools/sportmonks_odds/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetPremiumOddsByFixtureParams extends SportmonksBaseParams {
  fixtureId: string
}

export interface SportmonksGetPremiumOddsByFixtureResponse extends ToolResponse {
  output: {
    premiumOdds: SportmonksPremiumOdd[]
  }
}

export const sportmonksOddsGetPremiumOddsByFixtureTool: ToolConfig<
  SportmonksGetPremiumOddsByFixtureParams,
  SportmonksGetPremiumOddsByFixtureResponse
> = {
  id: 'sportmonks_odds_get_premium_odds_by_fixture',
  name: 'Get Premium Odds by Fixture',
  description:
    'Retrieve premium (historical) pre-match odds for a fixture from the Sportmonks Odds API',
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
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_ODDS_BASE_URL}/premium/fixtures/${encodeURIComponent(params.fixtureId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_premium_odds_by_fixture')
    }
    return {
      success: true,
      output: {
        premiumOdds: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    premiumOdds: {
      type: 'array',
      description: 'Array of premium odd objects for the fixture',
      items: { type: 'object', properties: SPORTMONKS_PREMIUM_ODD_PROPERTIES },
    },
  },
}
