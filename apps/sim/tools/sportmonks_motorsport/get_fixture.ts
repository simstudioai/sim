import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_FIXTURE_PROPERTIES,
  type SportmonksMsFixture,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetFixtureParams extends SportmonksBaseParams {
  fixtureId: string
}

export interface SportmonksMsGetFixtureResponse extends ToolResponse {
  output: {
    fixture: SportmonksMsFixture | null
  }
}

export const sportmonksMotorsportGetFixtureTool: ToolConfig<
  SportmonksMsGetFixtureParams,
  SportmonksMsGetFixtureResponse
> = {
  id: 'sportmonks_motorsport_get_fixture',
  name: 'Get Motorsport Fixture by ID',
  description: 'Retrieve a single motorsport fixture (session) by its ID from Sportmonks',
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
      description: 'The unique id of the fixture (session)',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. participants;results;latestLaps;pitstops)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/fixtures/${encodeURIComponent(params.fixtureId.trim())}`
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
      description: 'The requested motorsport fixture (session) object',
      properties: SPORTMONKS_MS_FIXTURE_PROPERTIES,
    },
  },
}
