import type {
  AmplitudeListEventsParams,
  AmplitudeListEventsResponse,
} from '@/tools/amplitude/types'
import type { ToolConfig } from '@/tools/types'

export const listEventsTool: ToolConfig<AmplitudeListEventsParams, AmplitudeListEventsResponse> = {
  id: 'amplitude_list_events',
  name: 'Amplitude List Events',
  description:
    'List all event types in the Amplitude project with their weekly totals and unique counts.',
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
    url: 'https://amplitude.com/api/2/events/list',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:${params.secretKey}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || `Amplitude List Events API error: ${response.status}`)
    }

    const events = (data.data ?? []).map(
      (e: Record<string, unknown>) =>
        ({
          value: (e.value as string) ?? '',
          displayName: (e.display as string) ?? null,
          totals: (e.totals as number) ?? 0,
          hidden: (e.hidden as boolean) ?? false,
          deleted: (e.deleted as boolean) ?? false,
        }) as const
    )

    return {
      success: true,
      output: {
        events,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of event types in the project',
      items: {
        type: 'object',
        properties: {
          value: { type: 'string', description: 'Event type name' },
          displayName: { type: 'string', description: 'Event display name' },
          totals: { type: 'number', description: 'Weekly total count' },
          hidden: { type: 'boolean', description: 'Whether the event is hidden' },
          deleted: { type: 'boolean', description: 'Whether the event is deleted' },
        },
      },
    },
  },
}
