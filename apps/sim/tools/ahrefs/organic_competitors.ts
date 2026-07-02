import type {
  AhrefsOrganicCompetitorsParams,
  AhrefsOrganicCompetitorsResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS =
  'competitor_domain,domain_rating,keywords_common,keywords_target,keywords_competitor,traffic'

export const organicCompetitorsTool: ToolConfig<
  AhrefsOrganicCompetitorsParams,
  AhrefsOrganicCompetitorsResponse
> = {
  id: 'ahrefs_organic_competitors',
  name: 'Ahrefs Organic Competitors',
  description:
    'Get domains that compete with a target domain or URL for the same organic keywords, ranked by keyword overlap.',
  version: '1.0.0',

  params: {
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target domain or URL to analyze. Example: "example.com"',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/organic-competitors')
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
      throw new Error(data.error?.message || data.error || 'Failed to get organic competitors')
    }

    const competitors = (data.competitors || []).map((competitor: any) => ({
      domain: competitor.competitor_domain ?? null,
      domainRating: competitor.domain_rating ?? 0,
      commonKeywords: competitor.keywords_common ?? 0,
      targetKeywords: competitor.keywords_target ?? 0,
      competitorKeywords: competitor.keywords_competitor ?? 0,
      traffic: competitor.traffic ?? null,
    }))

    return {
      success: true,
      output: {
        competitors,
      },
    }
  },

  outputs: {
    competitors: {
      type: 'array',
      description: 'List of organic search competitors ranked by keyword overlap',
      items: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'The competitor domain',
            optional: true,
          },
          domainRating: { type: 'number', description: 'Domain Rating of the competitor' },
          commonKeywords: {
            type: 'number',
            description: 'Number of keywords the competitor and target both rank for',
          },
          targetKeywords: {
            type: 'number',
            description: 'Number of keywords the target ranks for',
          },
          competitorKeywords: {
            type: 'number',
            description: 'Number of keywords the competitor ranks for',
          },
          traffic: {
            type: 'number',
            description: 'Estimated monthly organic traffic for the competitor',
            optional: true,
          },
        },
      },
    },
  },
}
