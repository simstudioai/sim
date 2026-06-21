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

export interface SportmonksGetInplayLivescoresParams extends SportmonksBaseParams {}

export interface SportmonksGetInplayLivescoresResponse extends ToolResponse {
  output: {
    fixtures: SportmonksFixture[]
  }
}

export const sportmonksGetInplayLivescoresTool: ToolConfig<
  SportmonksGetInplayLivescoresParams,
  SportmonksGetInplayLivescoresResponse
> = {
  id: 'sportmonks_football_get_inplay_livescores',
  name: 'Get Inplay Livescores',
  description: 'Retrieve all fixtures that are currently being played (in-play) from Sportmonks',
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
    url: (params) =>
      appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/livescores/inplay`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_inplay_livescores')
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
      description: 'Array of in-play fixture objects',
      items: { type: 'object', properties: SPORTMONKS_FIXTURE_PROPERTIES },
    },
  },
}
