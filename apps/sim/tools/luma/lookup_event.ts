import type { LumaLookupEventParams, LumaLookupEventResponse } from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const lookupEventTool: ToolConfig<LumaLookupEventParams, LumaLookupEventResponse> = {
  id: 'luma_lookup_event',
  name: 'Luma Lookup Event',
  description:
    'Look up an event by its public URL or event ID to resolve its canonical ID, API ID, and approval status.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Luma API key',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public event URL on lu.ma (provide this or an event ID)',
    },
    eventId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event ID to look up (starts with evt-). Provide this or a URL.',
    },
    platform: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event platform to look up: luma or external (defaults to luma)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://public-api.luma.com/v1/calendar/lookup-event')
      if (params.url) url.searchParams.set('url', params.url.trim())
      if (params.eventId) url.searchParams.set('event_id', params.eventId.trim())
      if (params.platform) url.searchParams.set('platform', params.platform)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-luma-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to look up event')
    }

    const event = data.event as Record<string, unknown> | null

    return {
      success: true,
      output: {
        found: Boolean(event),
        eventId: (event?.id as string) ?? null,
        apiId: (event?.api_id as string) ?? null,
        status: (event?.status as string) ?? null,
      },
    }
  },

  outputs: {
    found: {
      type: 'boolean',
      description: 'Whether a matching event was found',
    },
    eventId: {
      type: 'string',
      description: 'Resolved event ID',
      optional: true,
    },
    apiId: {
      type: 'string',
      description: 'Resolved event API ID (deprecated identifier)',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Event approval status (approved, pending, rejected)',
      optional: true,
    },
  },
}
