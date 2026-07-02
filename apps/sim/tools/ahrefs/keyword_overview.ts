import type {
  AhrefsKeywordOverviewParams,
  AhrefsKeywordOverviewResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS =
  'keyword,volume,difficulty,cpc,clicks,searches_pct_clicks_organic_only,parent_topic,traffic_potential,intents'

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
      url.searchParams.set('keywords', params.keyword)
      url.searchParams.set('country', params.country || 'us')
      url.searchParams.set('select', SELECT_FIELDS)
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

    const result = (data.keywords || [])[0] || {}

    return {
      success: true,
      output: {
        overview: {
          keyword: result.keyword || '',
          searchVolume: result.volume ?? 0,
          keywordDifficulty: result.difficulty ?? null,
          cpc: result.cpc ?? null,
          clicks: result.clicks ?? null,
          clicksPercentage: result.searches_pct_clicks_organic_only ?? null,
          parentTopic: result.parent_topic ?? null,
          trafficPotential: result.traffic_potential ?? null,
          intents: result.intents ?? null,
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
          optional: true,
        },
        cpc: { type: 'number', description: 'Cost per click in USD', optional: true },
        clicks: { type: 'number', description: 'Estimated clicks per month', optional: true },
        clicksPercentage: {
          type: 'number',
          description: 'Percentage of searches that result in an organic click',
          optional: true,
        },
        parentTopic: {
          type: 'string',
          description: 'The parent topic for this keyword',
          optional: true,
        },
        trafficPotential: {
          type: 'number',
          description: 'Estimated traffic potential if ranking #1',
          optional: true,
        },
        intents: {
          type: 'object',
          description:
            'Search intent flags (informational, navigational, commercial, transactional, branded, local)',
          optional: true,
          properties: {
            informational: { type: 'boolean', description: 'Query seeks information' },
            navigational: { type: 'boolean', description: 'Query seeks a specific site or page' },
            commercial: { type: 'boolean', description: 'Query researches a purchase decision' },
            transactional: { type: 'boolean', description: 'Query intends to complete a purchase' },
            branded: { type: 'boolean', description: 'Query references a specific brand' },
            local: { type: 'boolean', description: 'Query seeks local results' },
          },
        },
      },
    },
  },
}
