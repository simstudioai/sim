import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_CONTINENT_PROPERTIES,
  SPORTMONKS_CORE_BASE_URL,
  type SportmonksContinent,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetContinentParams extends SportmonksBaseParams {
  continentId: string
}

export interface SportmonksGetContinentResponse extends ToolResponse {
  output: {
    continent: SportmonksContinent | null
  }
}

export const sportmonksCoreGetContinentTool: ToolConfig<
  SportmonksGetContinentParams,
  SportmonksGetContinentResponse
> = {
  id: 'sportmonks_core_get_continent',
  name: 'Get Continent by ID',
  description: 'Retrieve a single continent by its ID from the Sportmonks Core API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    continentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the continent',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. countries)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_CORE_BASE_URL}/continents/${encodeURIComponent(params.continentId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_continent')
    }
    return {
      success: true,
      output: {
        continent: data.data ?? null,
      },
    }
  },

  outputs: {
    continent: {
      type: 'object',
      description: 'The requested continent object',
      properties: SPORTMONKS_CONTINENT_PROPERTIES,
    },
  },
}
