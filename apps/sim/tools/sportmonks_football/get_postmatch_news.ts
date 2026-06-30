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
  SPORTMONKS_NEWS_PROPERTIES,
  type SportmonksNews,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetPostmatchNewsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetPostmatchNewsResponse extends ToolResponse {
  output: {
    news: SportmonksNews[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetPostmatchNewsTool: ToolConfig<
  SportmonksGetPostmatchNewsParams,
  SportmonksGetPostmatchNewsResponse
> = {
  id: 'sportmonks_football_get_postmatch_news',
  name: 'Get Post-Match News',
  description:
    'Retrieve all post-match news articles available within your Sportmonks subscription',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. fixture;league)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. newsitemLeagues:8)',
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
      description: 'Order news by id (asc or desc)',
    },
  },

  request: {
    url: (params) =>
      appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/news/post-match`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_postmatch_news')
    }
    return {
      success: true,
      output: {
        news: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    news: {
      type: 'array',
      description: 'Array of post-match news articles',
      items: { type: 'object', properties: SPORTMONKS_NEWS_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
