import type { AhrefsRelatedTermsParams, AhrefsRelatedTermsResponse } from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS =
  'keyword,volume,difficulty,cpc,parent_topic,traffic_potential,intents,serp_features'

export const relatedTermsTool: ToolConfig<AhrefsRelatedTermsParams, AhrefsRelatedTermsResponse> = {
  id: 'ahrefs_related_terms',
  name: 'Ahrefs Related Terms',
  description:
    'Get keyword ideas related to a seed keyword: terms the same top-ranking pages also rank for ("also rank for") or also discuss ("also talk about"), with volume, difficulty, and CPC.',
  version: '1.0.0',

  params: {
    keyword: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The seed keyword to find related terms for',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code for keyword data. Example: "us", "gb", "de" (default: "us")',
    },
    terms: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Type of related keywords to return: "also_rank_for", "also_talk_about", or "all" (default: "all")',
    },
    viewFor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to derive related terms from the top 10 or top 100 ranking pages (default: "top_10")',
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
      const url = new URL('https://api.ahrefs.com/v3/keywords-explorer/related-terms')
      url.searchParams.set('select', SELECT_FIELDS)
      url.searchParams.set('country', params.country || 'us')
      url.searchParams.set('keywords', params.keyword)
      if (params.terms) url.searchParams.set('terms', params.terms)
      if (params.viewFor) url.searchParams.set('view_for', params.viewFor)
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
      throw new Error(data.error?.message || data.error || 'Failed to get related terms')
    }

    const relatedTerms = (data.keywords || []).map((item: any) => ({
      keyword: item.keyword || '',
      volume: item.volume ?? null,
      keywordDifficulty: item.difficulty ?? null,
      cpc: typeof item.cpc === 'number' ? item.cpc / 100 : null,
      parentTopic: item.parent_topic ?? null,
      trafficPotential: item.traffic_potential ?? null,
      intents: item.intents ?? null,
      serpFeatures: item.serp_features ?? [],
    }))

    return {
      success: true,
      output: {
        relatedTerms,
      },
    }
  },

  outputs: {
    relatedTerms: {
      type: 'array',
      description: 'Related keyword ideas for the seed keyword',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'The related keyword' },
          volume: { type: 'number', description: 'Average monthly search volume', optional: true },
          keywordDifficulty: {
            type: 'number',
            description: 'Keyword difficulty score (0-100)',
            optional: true,
          },
          cpc: { type: 'number', description: 'Cost per click in USD', optional: true },
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
          },
          serpFeatures: {
            type: 'array',
            description: 'SERP features present in the results',
            items: { type: 'string' },
          },
        },
      },
    },
  },
}
