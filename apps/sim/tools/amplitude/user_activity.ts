import type {
  AmplitudeUserActivityParams,
  AmplitudeUserActivityResponse,
} from '@/tools/amplitude/types'
import type { ToolConfig } from '@/tools/types'

export const userActivityTool: ToolConfig<
  AmplitudeUserActivityParams,
  AmplitudeUserActivityResponse
> = {
  id: 'amplitude_user_activity',
  name: 'Amplitude User Activity',
  description: 'Get the event stream for a specific user by their Amplitude ID.',
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
    amplitudeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amplitude internal user ID',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination (default 0)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of events to return (default 1000, max 1000)',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: "latest" or "earliest" (default: latest)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://amplitude.com/api/2/useractivity')
      url.searchParams.set('user', params.amplitudeId.trim())
      if (params.offset) url.searchParams.set('offset', params.offset)
      if (params.limit) url.searchParams.set('limit', params.limit)
      if (params.direction) url.searchParams.set('direction', params.direction)
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
      throw new Error(data.error || `Amplitude User Activity API error: ${response.status}`)
    }

    const events = (data.events ?? []).map(
      (e: Record<string, unknown>) =>
        ({
          eventType: (e.event_type as string) ?? '',
          eventTime: (e.event_time as string) ?? '',
          eventProperties: (e.event_properties as Record<string, unknown>) ?? {},
          userProperties: (e.user_properties as Record<string, unknown>) ?? {},
          sessionId: (e.session_id as number) ?? null,
          platform: (e.platform as string) ?? null,
          country: (e.country as string) ?? null,
          city: (e.city as string) ?? null,
        }) as const
    )

    const ud = data.userData as Record<string, unknown> | undefined
    const userData = ud
      ? {
          userId: (ud.user_id as string) ?? null,
          canonicalAmplitudeId: (ud.canonical_amplitude_id as number) ?? null,
          numEvents: (ud.num_events as number) ?? null,
          numSessions: (ud.num_sessions as number) ?? null,
          platform: (ud.platform as string) ?? null,
          country: (ud.country as string) ?? null,
        }
      : null

    return {
      success: true,
      output: {
        events,
        userData,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of user events',
      items: {
        type: 'object',
        properties: {
          eventType: { type: 'string', description: 'Type of event' },
          eventTime: { type: 'string', description: 'Event timestamp' },
          eventProperties: { type: 'json', description: 'Custom event properties' },
          userProperties: { type: 'json', description: 'User properties at event time' },
          sessionId: { type: 'number', description: 'Session ID' },
          platform: { type: 'string', description: 'Platform' },
          country: { type: 'string', description: 'Country' },
          city: { type: 'string', description: 'City' },
        },
      },
    },
    userData: {
      type: 'json',
      description: 'User metadata',
      optional: true,
      properties: {
        userId: { type: 'string', description: 'External user ID' },
        canonicalAmplitudeId: { type: 'number', description: 'Canonical Amplitude ID' },
        numEvents: { type: 'number', description: 'Total event count' },
        numSessions: { type: 'number', description: 'Total session count' },
        platform: { type: 'string', description: 'Primary platform' },
        country: { type: 'string', description: 'Country' },
      },
    },
  },
}
