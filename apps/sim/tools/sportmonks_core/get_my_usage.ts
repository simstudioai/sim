import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  SPORTMONKS_PAGINATION_OUTPUT,
  type SportmonksBaseParams,
  type SportmonksPagination,
  type SportmonksPaginationParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MY_BASE_URL,
  SPORTMONKS_USAGE_PROPERTIES,
  type SportmonksUsage,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetMyUsageParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetMyUsageResponse extends ToolResponse {
  output: {
    usage: SportmonksUsage[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksCoreGetMyUsageTool: ToolConfig<
  SportmonksGetMyUsageParams,
  SportmonksGetMyUsageResponse
> = {
  id: 'sportmonks_core_get_my_usage',
  name: 'Get My Usage',
  description: 'Retrieve your Sportmonks API usage aggregated per 5 minutes',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    per_page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 50, default 25)',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number to retrieve',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order direction (asc or desc)',
    },
  },

  request: {
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_MY_BASE_URL}/usage`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_my_usage')
    }
    return {
      success: true,
      output: {
        usage: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    usage: {
      type: 'array',
      description: 'Array of API usage records aggregated per 5-minute period',
      items: { type: 'object', properties: SPORTMONKS_USAGE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
