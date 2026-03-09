import type {
  AmplitudeRealtimeActiveUsersParams,
  AmplitudeRealtimeActiveUsersResponse,
} from '@/tools/amplitude/types'
import type { ToolConfig } from '@/tools/types'

export const realtimeActiveUsersTool: ToolConfig<
  AmplitudeRealtimeActiveUsersParams,
  AmplitudeRealtimeActiveUsersResponse
> = {
  id: 'amplitude_realtime_active_users',
  name: 'Amplitude Real-time Active Users',
  description: 'Get real-time active user counts at 5-minute granularity for the last 2 days.',
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
  },

  request: {
    url: 'https://amplitude.com/api/2/realtime',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:${params.secretKey}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || `Amplitude Real-time API error: ${response.status}`)
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
      description: 'Array of data series with active user counts at 5-minute intervals',
    },
    seriesLabels: {
      type: 'array',
      description: 'Labels for each series (e.g., "Today", "Yesterday")',
      items: { type: 'string' },
    },
    xValues: {
      type: 'array',
      description: 'Time values for the x-axis (e.g., "15:00", "15:05")',
      items: { type: 'string' },
    },
  },
}
