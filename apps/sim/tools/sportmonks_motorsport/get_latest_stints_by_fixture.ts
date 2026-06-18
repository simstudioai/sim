import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_STINT_PROPERTIES,
  type SportmonksMsStint,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetLatestStintsByFixtureParams extends SportmonksBaseParams {
  fixtureId: string
}

export interface SportmonksMsGetLatestStintsByFixtureResponse extends ToolResponse {
  output: {
    stints: SportmonksMsStint[]
  }
}

export const sportmonksMotorsportGetLatestStintsByFixtureTool: ToolConfig<
  SportmonksMsGetLatestStintsByFixtureParams,
  SportmonksMsGetLatestStintsByFixtureResponse
> = {
  id: 'sportmonks_motorsport_get_latest_stints_by_fixture',
  name: 'Get Latest Stints by Fixture',
  description:
    'Retrieve the latest tyre stints for a motorsport fixture (session) by fixture ID from Sportmonks',
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
        'Semicolon-separated relations to enrich the response (e.g. participant;details)',
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
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/fixtures/${encodeURIComponent(params.fixtureId.trim())}/stints/latest`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_latest_stints_by_fixture')
    }
    return {
      success: true,
      output: {
        stints: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    stints: {
      type: 'array',
      description: 'Array of the latest stint objects for the fixture',
      items: { type: 'object', properties: SPORTMONKS_MS_STINT_PROPERTIES },
    },
  },
}
