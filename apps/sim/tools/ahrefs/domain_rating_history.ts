import type {
  AhrefsDomainRatingHistoryParams,
  AhrefsDomainRatingHistoryResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

export const domainRatingHistoryTool: ToolConfig<
  AhrefsDomainRatingHistoryParams,
  AhrefsDomainRatingHistoryResponse
> = {
  id: 'ahrefs_domain_rating_history',
  name: 'Ahrefs Domain Rating History',
  description:
    'Get the historical Domain Rating (DR) trend for a target domain or URL over a date range, grouped daily, weekly, or monthly.',
  version: '1.0.0',

  params: {
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target domain or URL to analyze. Example: "example.com"',
    },
    dateFrom: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Start date of the historical period, in YYYY-MM-DD format',
    },
    dateTo: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'End date of the historical period, in YYYY-MM-DD format (defaults to today)',
    },
    historyGrouping: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time interval for grouping data points: "daily", "weekly", or "monthly" (default: "monthly")',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/domain-rating-history')
      url.searchParams.set('target', params.target)
      url.searchParams.set('date_from', params.dateFrom)
      if (params.dateTo) url.searchParams.set('date_to', params.dateTo)
      if (params.historyGrouping) url.searchParams.set('history_grouping', params.historyGrouping)
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
      throw new Error(data.error?.message || data.error || 'Failed to get domain rating history')
    }

    const domainRatings = (data.domain_ratings || []).map((item: any) => ({
      date: item.date || '',
      domainRating: item.domain_rating ?? 0,
    }))

    return {
      success: true,
      output: {
        domainRatings,
      },
    }
  },

  outputs: {
    domainRatings: {
      type: 'array',
      description: 'Historical Domain Rating data points',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'The date of the measurement' },
          domainRating: { type: 'number', description: 'Domain Rating score (0-100) on this date' },
        },
      },
    },
  },
}
