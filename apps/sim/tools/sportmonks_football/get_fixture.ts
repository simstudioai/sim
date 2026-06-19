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

export interface SportmonksGetFixtureParams extends SportmonksBaseParams {
  fixtureId: string
}

export interface SportmonksGetFixtureResponse extends ToolResponse {
  output: {
    fixture: SportmonksFixture | null
  }
}

export const sportmonksGetFixtureTool: ToolConfig<
  SportmonksGetFixtureParams,
  SportmonksGetFixtureResponse
> = {
  id: 'sportmonks_football_get_fixture',
  name: 'Get Fixture by ID',
  description: 'Retrieve a single football fixture by its ID from Sportmonks',
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
      description:
        'Semicolon-separated relations to enrich the response (e.g. participants;scores;events;lineups;statistics)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. eventTypes:14)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/fixtures/${encodeURIComponent(params.fixtureId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_fixture')
    }
    return {
      success: true,
      output: {
        fixture: data.data ?? null,
      },
    }
  },

  outputs: {
    fixture: {
      type: 'object',
      description: 'The requested fixture object',
      properties: SPORTMONKS_FIXTURE_PROPERTIES,
    },
  },
}
