import type {
  AhrefsRefdomainsHistoryParams,
  AhrefsRefdomainsHistoryResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

export const refdomainsHistoryTool: ToolConfig<
  AhrefsRefdomainsHistoryParams,
  AhrefsRefdomainsHistoryResponse
> = {
  id: 'ahrefs_refdomains_history',
  name: 'Ahrefs Referring Domains History',
  description:
    'Get the historical referring domains trend for a target domain or URL over a date range, grouped daily, weekly, or monthly.',
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
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Analysis mode: domain (entire domain), prefix (URL prefix), subdomains (include all subdomains, default), exact (exact URL match)',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/refdomains-history')
      url.searchParams.set('target', params.target)
      url.searchParams.set('date_from', params.dateFrom)
      if (params.dateTo) url.searchParams.set('date_to', params.dateTo)
      if (params.historyGrouping) url.searchParams.set('history_grouping', params.historyGrouping)
      if (params.mode) url.searchParams.set('mode', params.mode)
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
      throw new Error(
        data.error?.message || data.error || 'Failed to get referring domains history'
      )
    }

    const referringDomainsHistory = (data.refdomains || []).map((item: any) => ({
      date: item.date || '',
      referringDomains: item.refdomains ?? 0,
    }))

    return {
      success: true,
      output: {
        referringDomainsHistory,
      },
    }
  },

  outputs: {
    referringDomainsHistory: {
      type: 'array',
      description: 'Historical referring domains count data points',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'The date of the data point' },
          referringDomains: {
            type: 'number',
            description: 'Total number of unique domains linking to the target on this date',
          },
        },
      },
    },
  },
}
