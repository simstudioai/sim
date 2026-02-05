import type {
  AhrefsOrganicKeywordsParams,
  AhrefsOrganicKeywordsResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

export const organicKeywordsTool: ToolConfig<
  AhrefsOrganicKeywordsParams,
  AhrefsOrganicKeywordsResponse
> = {
  id: 'ahrefs_organic_keywords',
  name: 'Ahrefs Organic Keywords',
  description:
    'Get organic keywords that a target domain or URL ranks for in Google search results. Returns keyword details including search volume, ranking position, and estimated traffic.',
  version: '1.0.0',

  params: {
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The target domain or URL to analyze. Example: "example.com" or "https://example.com/page"',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code for search results. Example: "us", "gb", "de" (default: "us")',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Analysis mode: domain (entire domain), prefix (URL prefix), subdomains (include all subdomains), exact (exact URL match). Example: "domain"',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Date for historical data in YYYY-MM-DD format (defaults to today)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return. Example: 50 (default: 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination. Example: 100',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/organic-keywords')
      url.searchParams.set('target', params.target)
      url.searchParams.set('country', params.country || 'us')
      // Date is required - default to today if not provided
      const date = params.date || new Date().toISOString().split('T')[0]
      url.searchParams.set('date', date)
      if (params.mode) url.searchParams.set('mode', params.mode)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.offset) url.searchParams.set('offset', String(params.offset))
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
      throw new Error(data.error?.message || data.error || 'Failed to get organic keywords')
    }

    const keywords = (data.keywords || data.organic_keywords || []).map((kw: any) => ({
      keyword: kw.keyword || '',
      volume: kw.volume ?? 0,
      position: kw.position ?? 0,
      url: kw.url || '',
      traffic: kw.traffic ?? 0,
      keywordDifficulty: kw.keyword_difficulty ?? kw.difficulty ?? 0,
    }))

    return {
      success: true,
      output: {
        keywords,
      },
    }
  },

  outputs: {
    keywords: {
      type: 'array',
      description: 'List of organic keywords the target ranks for',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'The keyword' },
          volume: { type: 'number', description: 'Monthly search volume' },
          position: { type: 'number', description: 'Current ranking position' },
          url: { type: 'string', description: 'The URL that ranks for this keyword' },
          traffic: { type: 'number', description: 'Estimated monthly organic traffic' },
          keywordDifficulty: {
            type: 'number',
            description: 'Keyword difficulty score (0-100)',
          },
        },
      },
    },
  },
}
