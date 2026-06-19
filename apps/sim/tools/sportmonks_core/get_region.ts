import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_CORE_BASE_URL,
  SPORTMONKS_REGION_PROPERTIES,
  type SportmonksRegion,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetRegionParams extends SportmonksBaseParams {
  regionId: string
}

export interface SportmonksGetRegionResponse extends ToolResponse {
  output: {
    region: SportmonksRegion | null
  }
}

export const sportmonksCoreGetRegionTool: ToolConfig<
  SportmonksGetRegionParams,
  SportmonksGetRegionResponse
> = {
  id: 'sportmonks_core_get_region',
  name: 'Get Region by ID',
  description: 'Retrieve a single region by its ID from the Sportmonks Core API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    regionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the region',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. country;cities)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_CORE_BASE_URL}/regions/${encodeURIComponent(params.regionId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_region')
    }
    return {
      success: true,
      output: {
        region: data.data ?? null,
      },
    }
  },

  outputs: {
    region: {
      type: 'object',
      description: 'The requested region object',
      properties: SPORTMONKS_REGION_PROPERTIES,
    },
  },
}
