import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_CITY_PROPERTIES,
  SPORTMONKS_CORE_BASE_URL,
  type SportmonksCity,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetCityParams extends SportmonksBaseParams {
  cityId: string
}

export interface SportmonksGetCityResponse extends ToolResponse {
  output: {
    city: SportmonksCity | null
  }
}

export const sportmonksCoreGetCityTool: ToolConfig<
  SportmonksGetCityParams,
  SportmonksGetCityResponse
> = {
  id: 'sportmonks_core_get_city',
  name: 'Get City by ID',
  description: 'Retrieve a single city by its ID from the Sportmonks Core API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    cityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the city',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. region)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_CORE_BASE_URL}/cities/${encodeURIComponent(params.cityId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_city')
    }
    return {
      success: true,
      output: {
        city: data.data ?? null,
      },
    }
  },

  outputs: {
    city: {
      type: 'object',
      description: 'The requested city object',
      properties: SPORTMONKS_CITY_PROPERTIES,
    },
  },
}
