import type {
  AmplitudeGetRevenueParams,
  AmplitudeGetRevenueResponse,
} from '@/tools/amplitude/types'
import { getDashboardHost } from '@/tools/amplitude/utils'
import type { ToolConfig } from '@/tools/types'

export const getRevenueTool: ToolConfig<AmplitudeGetRevenueParams, AmplitudeGetRevenueResponse> = {
  id: 'amplitude_get_revenue',
  name: 'Amplitude Get Revenue',
  description: 'Get revenue LTV data including ARPU, ARPPU, total revenue, and paying user counts.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Amplitude API Key',
    },
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Amplitude Secret Key',
    },
    start: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date in YYYYMMDD format',
    },
    end: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date in YYYYMMDD format',
    },
    metric: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Metric: 0 (ARPU), 1 (ARPPU), 2 (Total Revenue), 3 (Paying Users)',
    },
    interval: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time interval: 1 (daily), 7 (weekly), or 30 (monthly)',
    },
    groupBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Property name to group by (limit: one)',
    },
    segment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON segment definition(s) applied to the query',
    },
    dataResidency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data residency region: "us" (default) or "eu"',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${getDashboardHost(params.dataResidency)}/api/2/revenue/ltv`)
      url.searchParams.set('start', params.start)
      url.searchParams.set('end', params.end)
      if (params.metric) url.searchParams.set('m', params.metric)
      if (params.interval) url.searchParams.set('i', params.interval)
      if (params.groupBy) url.searchParams.set('g', params.groupBy)
      if (params.segment) url.searchParams.set('s', params.segment)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:${params.secretKey}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || `Amplitude Revenue API error: ${response.status}`)
    }

    const result = data.data ?? {}

    return {
      success: true,
      output: {
        series: result.series ?? [],
        seriesLabels: result.seriesLabels ?? [],
      },
    }
  },

  outputs: {
    series: {
      type: 'array',
      description:
        'Revenue data series [{dates: [YYYY-MM-DD], values: {<date>: {r1d..r90d, count, paid, total_amount}}}]',
      items: {
        type: 'json',
        properties: {
          dates: {
            type: 'array',
            description: 'Dates covered by this series',
            items: { type: 'string' },
          },
          values: {
            type: 'json',
            description:
              'Per-date metric values keyed by date (r1d..r90d, count, paid, total_amount)',
          },
        },
      },
    },
    seriesLabels: {
      type: 'array',
      description: 'Labels for each data series',
      items: { type: 'string' },
    },
  },
}
