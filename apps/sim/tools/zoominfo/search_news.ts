import type { ToolConfig } from '@/tools/types'
import type { ZoomInfoSearchNewsParams, ZoomInfoSearchNewsResponse } from '@/tools/zoominfo/types'
import {
  buildProxyBody,
  extractDataArray,
  extractPagination,
  paginationOutputProperties,
  parseCsvOrJson,
  toNumberOrUndefined,
  transformZoomInfoEnvelope,
  ZOOMINFO_PROXY_URL,
} from '@/tools/zoominfo/utils'

export const zoominfoSearchNewsTool: ToolConfig<
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

  request: {
    url: ZOOMINFO_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const attributes: Record<string, unknown> = {}
      const categories = parseCsvOrJson(params.categories, 'categories')
      if (categories) attributes.categories = categories
      const urls = parseCsvOrJson(params.url, 'url')
      if (urls) attributes.url = urls
      if (params.pageDateMin) attributes.pageDateMin = params.pageDateMin
      if (params.pageDateMax) attributes.pageDateMax = params.pageDateMax

      if (Object.keys(attributes).length === 0) {
        throw new Error('Provide at least one of: categories, url, pageDateMin, pageDateMax')
      }

      const query: Record<string, string | number> = {}
      const page = toNumberOrUndefined(params.page)
      const rpp = toNumberOrUndefined(params.rpp)
      if (page !== undefined) query['page[number]'] = page
      if (rpp !== undefined) query['page[size]'] = rpp

      return {
        ...buildProxyBody(params),
        path: '/data/v1/news/search',
        method: 'POST',
        query: Object.keys(query).length > 0 ? query : undefined,
        body: {
          data: {
            type: 'NewsSearch',
            attributes,
          },
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoEnvelope(response)
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
