import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FIXTURE_PROPERTIES,
  SPORTMONKS_FOOTBALL_BASE_URL,
  type SportmonksFixture,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetLatestFixturesParams extends SportmonksBaseParams {}

export interface SportmonksGetLatestFixturesResponse extends ToolResponse {
  output: {
    fixtures: SportmonksFixture[]
  }
}

export const sportmonksGetLatestFixturesTool: ToolConfig<
  SportmonksGetLatestFixturesParams,
  SportmonksGetLatestFixturesResponse
> = {
  id: 'sportmonks_football_get_latest_fixtures',
  name: 'Get Latest Updated Fixtures',
  description: 'Retrieve all fixtures that have received updates within the last 10 seconds',
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
        'Semicolon-separated relations to enrich the response (e.g. participants;scores)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. fixtureLeagues:501)',
    },
  },

  request: {
    url: (params) =>
      appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/fixtures/latest`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_latest_fixtures')
    }
    return {
      success: true,
      output: {
        fixtures: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    fixtures: {
      type: 'array',
      description: 'Array of recently updated fixture objects',
      items: { type: 'object', properties: SPORTMONKS_FIXTURE_PROPERTIES },
    },
  },
}
