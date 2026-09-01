import type { InternalToolConfig } from '@/tools/types'
import type { ZoomInfoSearchNewsParams, ZoomInfoSearchNewsResponse } from '@/tools/zoominfo/types'
import {
  extractDataArray,
  extractPagination,
  paginationOutputProperties,
  transformZoomInfoResponse,
} from '@/tools/zoominfo/utils'

export const zoominfoSearchNewsTool: InternalToolConfig<
  ZoomInfoSearchNewsParams,
  ZoomInfoSearchNewsResponse
> = {
  id: 'zoominfo_search_news',
  name: 'ZoomInfo Search News',
  description: 'Search ZoomInfo news articles by category, URL, or date range.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ZoomInfo OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ZoomInfo OAuth client secret',
    },
    categories: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'News categories as JSON array or comma-separated list',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'News source URLs as JSON array or comma-separated list',
    },
    pageDateMin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Earliest publish date (YYYY-MM-DD)',
    },
    pageDateMax: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Latest publish date (YYYY-MM-DD)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (1-based)',
    },
    rpp: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (1-100, default 25)',
    },
  },

  operation: {
    input: (params) => params,
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoResponse(response)
    const articles = extractDataArray(data)
    const pagination = extractPagination(data)
    return {
      success: true,
      output: {
        articles,
        ...pagination,
      },
    }
  },

  outputs: {
    articles: {
      type: 'array',
      description: 'News articles matching the filters',
      items: { type: 'json' },
    },
    ...paginationOutputProperties,
  },
}
