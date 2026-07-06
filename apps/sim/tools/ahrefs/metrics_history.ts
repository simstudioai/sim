import type { AhrefsMetricsHistoryParams, AhrefsMetricsHistoryResponse } from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS = 'date,org_traffic,org_cost,paid_traffic,paid_cost'

export const metricsHistoryTool: ToolConfig<
  AhrefsMetricsHistoryParams,
  AhrefsMetricsHistoryResponse
> = {
  id: 'ahrefs_metrics_history',
  name: 'Ahrefs Metrics History',
  description:
    'Get the historical organic and paid traffic trend for a target domain or URL over a date range: organic traffic/cost and paid traffic/cost at each point in time.',
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
    volumeMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search volume calculation: "monthly" or "average" (default: "monthly")',
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
      description: 'Country code for traffic data. Example: "us", "gb", "de"',
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
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/metrics-history')
      url.searchParams.set('target', params.target)
      url.searchParams.set('date_from', params.dateFrom)
      if (params.dateTo) url.searchParams.set('date_to', params.dateTo)
      url.searchParams.set('select', SELECT_FIELDS)
      url.searchParams.set('volume_mode', params.volumeMode || 'monthly')
      if (params.historyGrouping) url.searchParams.set('history_grouping', params.historyGrouping)
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
      throw new Error(data.error?.message || data.error || 'Failed to get metrics history')
    }

    const metrics = (data.metrics || []).map((item: any) => ({
      date: item.date || '',
      organicTraffic: item.org_traffic ?? 0,
      organicCost: typeof item.org_cost === 'number' ? item.org_cost / 100 : null,
      paidTraffic: item.paid_traffic ?? 0,
      paidCost: typeof item.paid_cost === 'number' ? item.paid_cost / 100 : null,
    }))

    return {
      success: true,
      output: {
        metricsHistory: metrics,
      },
    }
  },

  outputs: {
    metricsHistory: {
      type: 'array',
      description: 'Historical organic and paid traffic data points',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date of the metric entry' },
          organicTraffic: { type: 'number', description: 'Estimated monthly organic visits' },
          organicCost: {
            type: 'number',
            description: 'Estimated monthly cost to replicate organic traffic via ads (USD)',
            optional: true,
          },
          paidTraffic: { type: 'number', description: 'Estimated monthly paid search visits' },
          paidCost: {
            type: 'number',
            description: 'Estimated monthly paid search spend (USD)',
            optional: true,
          },
        },
      },
    },
  },
}
