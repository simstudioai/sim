import type {
  SimilarwebPagesPerVisitParams,
  SimilarwebPagesPerVisitResponse,
} from '@/tools/similarweb/types'
import type { ToolConfig } from '@/tools/types'

export const similarwebPagesPerVisitTool: ToolConfig<
  SimilarwebPagesPerVisitParams,
  SimilarwebPagesPerVisitResponse
> = {
  id: 'similarweb_pages_per_visit',
  name: 'SimilarWeb Pages Per Visit',
  description: 'Get average pages per visit over time (desktop and mobile combined)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SimilarWeb API key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Website domain to analyze (e.g., "example.com" without www or protocol)',
    },
    country: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        '2-letter ISO country code (e.g., "us", "gb", "de") or "world" for worldwide data',
    },
    granularity: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data granularity: daily, weekly, or monthly',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date in YYYY-MM format (e.g., "2024-01")',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date in YYYY-MM format (e.g., "2024-12")',
    },
    mainDomainOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude subdomains from results',
    },
  },

  request: {
    url: (params) => {
      const domain = params.domain
        ?.trim()
        .replace(/^(https?:\/\/)?(www\.)?/, '')
        .replace(/\/$/, '')
      const url = new URL(
        `https://api.similarweb.com/v1/website/${domain}/total-traffic-and-engagement/pages-per-visit`
      )
      url.searchParams.set('api_key', params.apiKey?.trim())
      url.searchParams.set('country', params.country?.trim() ?? 'world')
      url.searchParams.set('granularity', params.granularity ?? 'monthly')
      url.searchParams.set('format', 'json')
      if (params.startDate) url.searchParams.set('start_date', params.startDate)
      if (params.endDate) url.searchParams.set('end_date', params.endDate)
      if (params.mainDomainOnly !== undefined)
        url.searchParams.set('main_domain_only', String(params.mainDomainOnly))
      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || 'Failed to get pages per visit')
    }

    const meta = data.meta ?? {}
    const request = meta.request ?? {}

    return {
      success: true,
      output: {
        domain: request.domain ?? null,
        country: request.country ?? null,
        granularity: request.granularity ?? null,
        lastUpdated: meta.last_updated ?? null,
        pagesPerVisit:
          data.pages_per_visit?.map((p: { date: string; pages_per_visit: number }) => ({
            date: p.date,
            pagesPerVisit: p.pages_per_visit,
          })) ?? [],
      },
    }
  },

  outputs: {
    domain: {
      type: 'string',
      description: 'Analyzed domain',
    },
    country: {
      type: 'string',
      description: 'Country filter applied',
    },
    granularity: {
      type: 'string',
      description: 'Data granularity',
    },
    lastUpdated: {
      type: 'string',
      description: 'Data last updated timestamp',
      optional: true,
    },
    pagesPerVisit: {
      type: 'array',
      description: 'Pages per visit data over time',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
          pagesPerVisit: { type: 'number', description: 'Average pages per visit' },
        },
      },
    },
  },
}
