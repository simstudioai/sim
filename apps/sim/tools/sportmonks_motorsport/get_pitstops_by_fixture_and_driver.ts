import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_LAP_PROPERTIES,
  type SportmonksMsLap,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetPitstopsByFixtureAndDriverParams extends SportmonksBaseParams {
  fixtureId: string
  driverId: string
}

export interface SportmonksMsGetPitstopsByFixtureAndDriverResponse extends ToolResponse {
  output: {
    pitstops: SportmonksMsLap[]
  }
}

export const sportmonksMotorsportGetPitstopsByFixtureAndDriverTool: ToolConfig<
  SportmonksMsGetPitstopsByFixtureAndDriverParams,
  SportmonksMsGetPitstopsByFixtureAndDriverResponse
> = {
  id: 'sportmonks_motorsport_get_pitstops_by_fixture_and_driver',
  name: 'Get Pitstops by Fixture and Driver',
  description: 'Retrieve all pitstops for a motorsport fixture and driver from Sportmonks',
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
    driverId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the driver',
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
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/fixtures/${encodeURIComponent(params.fixtureId.trim())}/pitstops/drivers/${encodeURIComponent(params.driverId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_pitstops_by_fixture_and_driver')
    }
    return {
      success: true,
      output: {
        pitstops: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    pitstops: {
      type: 'array',
      description: 'Array of pitstop objects for the fixture and driver',
      items: { type: 'object', properties: SPORTMONKS_MS_LAP_PROPERTIES },
    },
  },
}
