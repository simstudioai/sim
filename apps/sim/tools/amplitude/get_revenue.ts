import type {
  AmplitudeGetRevenueParams,
  AmplitudeGetRevenueResponse,
} from '@/tools/amplitude/types'
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
  },

  request: {
    url: (params) => {
      const url = new URL('https://amplitude.com/api/2/revenue/ltv')
      url.searchParams.set('start', params.start)
      url.searchParams.set('end', params.end)
      if (params.metric) url.searchParams.set('m', params.metric)
      if (params.interval) url.searchParams.set('i', params.interval)
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
        xValues: result.xValues ?? [],
      },
    }
  },

  outputs: {
    series: {
      type: 'json',
      description: 'Array of revenue data series',
    },
    seriesLabels: {
      type: 'array',
      description: 'Labels for each data series',
      items: { type: 'string' },
    },
    xValues: {
      type: 'array',
      description: 'Date values for the x-axis',
      items: { type: 'string' },
    },
  },
}
