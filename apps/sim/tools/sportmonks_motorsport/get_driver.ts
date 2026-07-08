import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_DRIVER_PROPERTIES,
  type SportmonksMsDriver,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetDriverParams extends SportmonksBaseParams {
  driverId: string
}

export interface SportmonksMsGetDriverResponse extends ToolResponse {
  output: {
    driver: SportmonksMsDriver | null
  }
}

export const sportmonksMotorsportGetDriverTool: ToolConfig<
  SportmonksMsGetDriverParams,
  SportmonksMsGetDriverResponse
> = {
  id: 'sportmonks_motorsport_get_driver',
  name: 'Get Driver by ID',
  description: 'Retrieve a single motorsport driver by their ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. country;teams)',
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
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/drivers/${encodeURIComponent(params.driverId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_driver')
    }
    return {
      success: true,
      output: {
        driver: data.data ?? null,
      },
    }
  },

  outputs: {
    driver: {
      type: 'object',
      description: 'The requested driver object',
      properties: SPORTMONKS_MS_DRIVER_PROPERTIES,
    },
  },
}
