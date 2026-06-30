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

export interface SportmonksGetLivescoresParams extends SportmonksBaseParams {}

export interface SportmonksGetLivescoresResponse extends ToolResponse {
  output: {
    fixtures: SportmonksFixture[]
  }
}

export const sportmonksGetLivescoresTool: ToolConfig<
  SportmonksGetLivescoresParams,
  SportmonksGetLivescoresResponse
> = {
  id: 'sportmonks_football_get_livescores',
  name: 'Get Livescores',
  description:
    'Retrieve fixtures starting within 15 minutes and currently in progress from Sportmonks',
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
        'Semicolon-separated relations to enrich the response (e.g. participants;scores;events)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. fixtureLeagues:501)',
    },
  },

  request: {
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/livescores`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_livescores')
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
      description: 'Array of live fixture objects',
      items: { type: 'object', properties: SPORTMONKS_FIXTURE_PROPERTIES },
    },
  },
}
