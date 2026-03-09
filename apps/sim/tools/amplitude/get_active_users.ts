import type {
  AmplitudeGetActiveUsersParams,
  AmplitudeGetActiveUsersResponse,
} from '@/tools/amplitude/types'
import type { ToolConfig } from '@/tools/types'

export const getActiveUsersTool: ToolConfig<
  AmplitudeGetActiveUsersParams,
  AmplitudeGetActiveUsersResponse
> = {
  id: 'amplitude_get_active_users',
  name: 'Amplitude Get Active Users',
  description: 'Get active or new user counts over a date range from the Dashboard REST API.',
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
      description: 'Metric type: "active" or "new" (default: active)',
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
      const url = new URL('https://amplitude.com/api/2/users')
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
      throw new Error(data.error || `Amplitude Active Users API error: ${response.status}`)
    }

    const result = data.data ?? {}

    return {
      success: true,
      output: {
        series: result.series ?? [],
        seriesMeta: result.seriesMeta ?? [],
        xValues: result.xValues ?? [],
      },
    }
  },

  outputs: {
    series: {
      type: 'json',
      description: 'Array of data series with user counts per time interval',
    },
    seriesMeta: {
      type: 'array',
      description: 'Metadata labels for each data series (e.g., segment names)',
      items: { type: 'string' },
    },
    xValues: {
      type: 'array',
      description: 'Date values for the x-axis',
      items: { type: 'string' },
    },
  },
}
