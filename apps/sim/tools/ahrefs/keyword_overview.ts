import type {
  AhrefsKeywordOverviewParams,
  AhrefsKeywordOverviewResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

export const keywordOverviewTool: ToolConfig<
  AhrefsKeywordOverviewParams,
  AhrefsKeywordOverviewResponse
> = {
  id: 'ahrefs_keyword_overview',
  name: 'Ahrefs Keyword Overview',
  description:
    'Get detailed metrics for a keyword including search volume, keyword difficulty, CPC, clicks, and traffic potential.',
  version: '1.0.0',

  params: {
    keyword: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The keyword to analyze',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code for keyword data. Example: "us", "gb", "de" (default: "us")',
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
      const url = new URL('https://api.ahrefs.com/v3/keywords-explorer/overview')
      url.searchParams.set('keyword', params.keyword)
      url.searchParams.set('country', params.country || 'us')
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
      throw new Error(data.error?.message || data.error || 'Failed to get keyword overview')
    }

    return {
      success: true,
      output: {
        overview: {
          keyword: data.keyword || '',
          searchVolume: data.volume ?? 0,
          keywordDifficulty: data.keyword_difficulty ?? data.difficulty ?? 0,
          cpc: data.cpc ?? 0,
          clicks: data.clicks ?? 0,
          clicksPercentage: data.clicks_percentage ?? 0,
          parentTopic: data.parent_topic || '',
          trafficPotential: data.traffic_potential ?? 0,
        },
      },
    }
  },

  outputs: {
    overview: {
      type: 'object',
      description: 'Keyword metrics overview',
      properties: {
        keyword: { type: 'string', description: 'The analyzed keyword' },
        searchVolume: { type: 'number', description: 'Monthly search volume' },
        keywordDifficulty: {
          type: 'number',
          description: 'Keyword difficulty score (0-100)',
        },
        cpc: { type: 'number', description: 'Cost per click in USD' },
        clicks: { type: 'number', description: 'Estimated clicks per month' },
        clicksPercentage: {
          type: 'number',
          description: 'Percentage of searches that result in clicks',
        },
        parentTopic: { type: 'string', description: 'The parent topic for this keyword' },
        trafficPotential: {
          type: 'number',
          description: 'Estimated traffic potential if ranking #1',
        },
      },
    },
  },
}
