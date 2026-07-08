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

export interface SportmonksMsGetStintsByFixtureAndStintParams extends SportmonksBaseParams {
  fixtureId: string
  stintNumber: string
}

export interface SportmonksMsGetStintsByFixtureAndStintResponse extends ToolResponse {
  output: {
    stints: SportmonksMsStint[]
  }
}

export const sportmonksMotorsportGetStintsByFixtureAndStintTool: ToolConfig<
  SportmonksMsGetStintsByFixtureAndStintParams,
  SportmonksMsGetStintsByFixtureAndStintResponse
> = {
  id: 'sportmonks_motorsport_get_stints_by_fixture_and_stint',
  name: 'Get Stints by Fixture and Stint Number',
  description: 'Retrieve all tyre stints for a motorsport fixture and stint number from Sportmonks',
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
    stintNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The stint number to retrieve',
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
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/fixtures/${encodeURIComponent(params.fixtureId.trim())}/stints/${encodeURIComponent(params.stintNumber.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_stints_by_fixture_and_stint')
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
      description: 'Array of stint objects for the fixture and stint number',
      items: { type: 'object', properties: SPORTMONKS_MS_STINT_PROPERTIES },
    },
  },
}
