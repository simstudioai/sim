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

export interface SportmonksGetFixturesByIdsParams extends SportmonksBaseParams {
  ids: string
}

export interface SportmonksGetFixturesByIdsResponse extends ToolResponse {
  output: {
    fixtures: SportmonksFixture[]
  }
}

export const sportmonksGetFixturesByIdsTool: ToolConfig<
  SportmonksGetFixturesByIdsParams,
  SportmonksGetFixturesByIdsResponse
> = {
  id: 'sportmonks_football_get_fixtures_by_ids',
  name: 'Get Fixtures by Multiple IDs',
  description: 'Retrieve multiple football fixtures by a comma-separated list of IDs (max 50)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    ids: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated fixture IDs (e.g. 18535517,18535518). Maximum of 50 IDs',
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
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/fixtures/multi/${encodeURIComponent(params.ids.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_fixtures_by_ids')
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
      description: 'Array of fixture objects for the requested IDs',
      items: { type: 'object', properties: SPORTMONKS_FIXTURE_PROPERTIES },
    },
  },
}
