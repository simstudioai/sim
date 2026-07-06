import type {
  AhrefsKeywordsHistoryParams,
  AhrefsKeywordsHistoryResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS = 'date,top3,top4_10,top11_20,top21_50,top51_plus'

export const keywordsHistoryTool: ToolConfig<
  AhrefsKeywordsHistoryParams,
  AhrefsKeywordsHistoryResponse
> = {
  id: 'ahrefs_keywords_history',
  name: 'Ahrefs Keywords History',
  description:
    'Get the historical organic keyword ranking distribution for a target domain or URL over a date range: how many keywords rank in each position bucket at each point in time.',
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
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code for search results. Example: "us", "gb", "de"',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/keywords-history')
      url.searchParams.set('target', params.target)
      url.searchParams.set('date_from', params.dateFrom)
      url.searchParams.set('select', SELECT_FIELDS)
      if (params.historyGrouping) url.searchParams.set('history_grouping', params.historyGrouping)
      if (params.dateTo) url.searchParams.set('date_to', params.dateTo)
      if (params.country) url.searchParams.set('country', params.country)
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
      throw new Error(data.error?.message || data.error || 'Failed to get keywords history')
    }

    const keywordsHistory = (data.keywords || []).map((item: any) => ({
      date: item.date || '',
      top3: item.top3 ?? 0,
      top4To10: item.top4_10 ?? 0,
      top11To20: item.top11_20 ?? 0,
      top21To50: item.top21_50 ?? 0,
      top51Plus: item.top51_plus ?? 0,
    }))

    return {
      success: true,
      output: {
        keywordsHistory,
      },
    }
  },

  outputs: {
    keywordsHistory: {
      type: 'array',
      description: 'Historical organic keyword ranking distribution',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date of the record' },
          top3: { type: 'number', description: 'Keywords ranking in top 3 organic results' },
          top4To10: { type: 'number', description: 'Keywords ranking in positions 4-10' },
          top11To20: { type: 'number', description: 'Keywords ranking in positions 11-20' },
          top21To50: { type: 'number', description: 'Keywords ranking in positions 21-50' },
          top51Plus: { type: 'number', description: 'Keywords ranking in position 51 and beyond' },
        },
      },
    },
  },
}
