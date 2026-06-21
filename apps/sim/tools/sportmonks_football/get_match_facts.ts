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
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_MATCH_FACT_PROPERTIES,
  type SportmonksMatchFact,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetMatchFactsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetMatchFactsResponse extends ToolResponse {
  output: {
    matchFacts: SportmonksMatchFact[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetMatchFactsTool: ToolConfig<
  SportmonksGetMatchFactsParams,
  SportmonksGetMatchFactsResponse
> = {
  id: 'sportmonks_football_get_match_facts',
  name: 'Get All Match Facts',
  description: 'Retrieve all available match facts within your Sportmonks subscription (beta)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. type;sport;fixture)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. matchFactTypes:76088)',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/match-facts`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_match_facts')
    }
    return {
      success: true,
      output: {
        matchFacts: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    matchFacts: {
      type: 'array',
      description: 'Array of match fact objects',
      items: { type: 'object', properties: SPORTMONKS_MATCH_FACT_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
