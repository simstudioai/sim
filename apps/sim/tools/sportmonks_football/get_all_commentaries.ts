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
  SPORTMONKS_COMMENTARY_PROPERTIES,
  SPORTMONKS_FOOTBALL_BASE_URL,
  type SportmonksCommentary,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetAllCommentariesParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetAllCommentariesResponse extends ToolResponse {
  output: {
    commentaries: SportmonksCommentary[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetAllCommentariesTool: ToolConfig<
  SportmonksGetAllCommentariesParams,
  SportmonksGetAllCommentariesResponse
> = {
  id: 'sportmonks_football_get_all_commentaries',
  name: 'Get All Commentaries',
  description: 'Retrieve all textual commentaries available within your Sportmonks subscription',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. fixture;player)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/commentaries`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_all_commentaries')
    }
    return {
      success: true,
      output: {
        commentaries: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    commentaries: {
      type: 'array',
      description: 'Array of commentary entries',
      items: { type: 'object', properties: SPORTMONKS_COMMENTARY_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
