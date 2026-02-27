import type { LumaGetEventParams, LumaGetEventResponse } from '@/tools/luma/types'
import { LUMA_EVENT_OUTPUT_PROPERTIES, LUMA_HOST_OUTPUT_PROPERTIES } from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const getEventTool: ToolConfig<LumaGetEventParams, LumaGetEventResponse> = {
  id: 'luma_get_event',
  name: 'Luma Get Event',
  description:
    'Retrieve details of a Luma event including name, time, location, hosts, and visibility settings.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Luma API key',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event ID (starts with evt-)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://public-api.luma.com/v1/event/get')
      url.searchParams.set('id', params.eventId)
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
      throw new Error(data.message || data.error || 'Failed to get event')
    }

    const event = data.event
    const hosts = (data.hosts ?? []).map((h: Record<string, unknown>) => ({
      name: (h.name as string) ?? null,
      email: (h.email as string) ?? null,
    }))

    return {
      success: true,
      output: {
        event: {
          id: event.id ?? null,
          name: event.name ?? null,
          startAt: event.start_at ?? null,
          endAt: event.end_at ?? null,
          timezone: event.timezone ?? null,
          durationInterval: event.duration_interval ?? null,
          createdAt: event.created_at ?? null,
          description: event.description ?? null,
          descriptionMd: event.description_md ?? null,
          coverUrl: event.cover_url ?? null,
          url: event.url ?? null,
          visibility: event.visibility ?? null,
          meetingUrl: event.meeting_url ?? null,
          geoAddressJson: event.geo_address_json ?? null,
          geoLatitude: event.geo_latitude ?? null,
          geoLongitude: event.geo_longitude ?? null,
          calendarId: event.calendar_id ?? null,
        },
        hosts,
      },
    }
  },

  outputs: {
    event: {
      type: 'object',
      description: 'Event details',
      properties: LUMA_EVENT_OUTPUT_PROPERTIES,
    },
    hosts: {
      type: 'array',
      description: 'Event hosts',
      items: {
        type: 'object',
        properties: LUMA_HOST_OUTPUT_PROPERTIES,
      },
    },
  },
}
