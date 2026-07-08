import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_CORE_BASE_URL,
  SPORTMONKS_COUNTRY_PROPERTIES,
  type SportmonksCountry,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetCountryParams extends SportmonksBaseParams {
  countryId: string
}

export interface SportmonksGetCountryResponse extends ToolResponse {
  output: {
    country: SportmonksCountry | null
  }
}

export const sportmonksCoreGetCountryTool: ToolConfig<
  SportmonksGetCountryParams,
  SportmonksGetCountryResponse
> = {
  id: 'sportmonks_core_get_country',
  name: 'Get Country by ID',
  description: 'Retrieve a single country by its ID from the Sportmonks Core API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    countryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the country',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. continent;regions)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_CORE_BASE_URL}/countries/${encodeURIComponent(params.countryId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_country')
    }
    return {
      success: true,
      output: {
        country: data.data ?? null,
      },
    }
  },

  outputs: {
    country: {
      type: 'object',
      description: 'The requested country object',
      properties: SPORTMONKS_COUNTRY_PROPERTIES,
    },
  },
}
