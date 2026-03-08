import type {
  AmplitudeEventSegmentationParams,
  AmplitudeEventSegmentationResponse,
} from '@/tools/amplitude/types'
import type { ToolConfig } from '@/tools/types'

export const eventSegmentationTool: ToolConfig<
  AmplitudeEventSegmentationParams,
  AmplitudeEventSegmentationResponse
> = {
  id: 'amplitude_event_segmentation',
  name: 'Amplitude Event Segmentation',
  description:
    'Query event analytics data with segmentation. Get event counts, uniques, averages, and more.',
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
    eventType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event type name to analyze',
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
      description:
        'Metric type: uniques, totals, pct_dau, average, histogram, sums, value_avg, or formula (default: uniques)',
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
      description: 'Property name to group by (prefix custom user properties with "gp:")',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of group-by values (max 1000)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://amplitude.com/api/2/events/segmentation')
      const eventObj = JSON.stringify({ event_type: params.eventType })
      url.searchParams.set('e', eventObj)
      url.searchParams.set('start', params.start)
      url.searchParams.set('end', params.end)
      if (params.metric) url.searchParams.set('m', params.metric)
      if (params.interval) url.searchParams.set('i', params.interval)
      if (params.groupBy) url.searchParams.set('g', params.groupBy)
      if (params.limit) url.searchParams.set('limit', params.limit)
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
      throw new Error(data.error || `Amplitude Event Segmentation API error: ${response.status}`)
    }

    const result = data.data ?? {}

    return {
      success: true,
      output: {
        series: result.series ?? [],
        seriesLabels: result.seriesLabels ?? [],
        seriesCollapsed: result.seriesCollapsed ?? [],
        xValues: result.xValues ?? [],
      },
    }
  },

  outputs: {
    series: {
      type: 'json',
      description: 'Time-series data arrays indexed by series',
    },
    seriesLabels: {
      type: 'array',
      description: 'Labels for each data series',
      items: { type: 'string' },
    },
    seriesCollapsed: {
      type: 'json',
      description: 'Collapsed aggregate totals per series',
    },
    xValues: {
      type: 'array',
      description: 'Date values for the x-axis',
      items: { type: 'string' },
    },
  },
}
