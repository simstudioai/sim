import type { AhrefsTopPagesParams, AhrefsTopPagesResponse } from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS = 'url,sum_traffic,keywords,top_keyword,value'

export const topPagesTool: ToolConfig<AhrefsTopPagesParams, AhrefsTopPagesResponse> = {
  id: 'ahrefs_top_pages',
  name: 'Ahrefs Top Pages',
  description:
    'Get the top pages of a target domain sorted by organic traffic. Returns page URLs with their traffic, keyword counts, and estimated traffic value.',
  version: '1.0.0',

  params: {
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target domain to analyze. Example: "example.com"',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code for traffic data. Example: "us", "gb", "de" (default: "us")',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Analysis mode: domain (entire domain), prefix (URL prefix), subdomains (include all subdomains, default), exact (exact URL match). Example: "domain"',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Date to report metrics on, in YYYY-MM-DD format (defaults to today)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return. Example: 50 (default: 1000)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ahrefs API Key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/top-pages')
      url.searchParams.set('target', params.target)
      url.searchParams.set('country', params.country || 'us')
      url.searchParams.set('select', SELECT_FIELDS)
      // Date is required - default to today if not provided
      const date = params.date || new Date().toISOString().split('T')[0]
      url.searchParams.set('date', date)
      if (params.mode) url.searchParams.set('mode', params.mode)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to get top pages')
    }

    const pages = (data.pages || []).map((page: any) => ({
      url: page.url ?? null,
      traffic: page.sum_traffic ?? 0,
      keywords: page.keywords ?? null,
      topKeyword: page.top_keyword ?? null,
      value: typeof page.value === 'number' ? page.value / 100 : null,
    }))

    return {
      success: true,
      output: {
        pages,
      },
    }
  },

  outputs: {
    pages: {
      type: 'array',
      description: 'List of top pages by organic traffic',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The page URL', optional: true },
          traffic: { type: 'number', description: 'Estimated monthly organic traffic' },
          keywords: {
            type: 'number',
            description: 'Number of keywords the page ranks for',
            optional: true,
          },
          topKeyword: {
            type: 'string',
            description: 'The top keyword driving traffic to this page',
            optional: true,
          },
          value: {
            type: 'number',
            description: 'Estimated traffic value in USD',
            optional: true,
          },
        },
      },
    },
  },
}
