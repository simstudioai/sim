import type { LumaCreateEventParams, LumaCreateEventResponse } from '@/tools/luma/types'
import { LUMA_EVENT_OUTPUT_PROPERTIES, LUMA_HOST_OUTPUT_PROPERTIES } from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const createEventTool: ToolConfig<LumaCreateEventParams, LumaCreateEventResponse> = {
  id: 'luma_create_event',
  name: 'Luma Create Event',
  description:
    'Create a new event on Luma with a name, start time, timezone, and optional details like description, location, and visibility.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Luma API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event name/title',
    },
    startAt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event start time in ISO 8601 format (e.g., 2025-03-15T18:00:00Z)',
    },
    timezone: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'IANA timezone (e.g., America/New_York, Europe/London)',
    },
    endAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event end time in ISO 8601 format (e.g., 2025-03-15T20:00:00Z)',
    },
    durationInterval: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Event duration as ISO 8601 interval (e.g., PT2H for 2 hours, PT30M for 30 minutes). Used if endAt is not provided.',
    },
    descriptionMd: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event description in Markdown format',
    },
    meetingUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Virtual meeting URL for online events (e.g., Zoom, Google Meet link)',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event visibility: public, members-only, or private (defaults to public)',
    },
    coverUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cover image URL (must be a Luma CDN URL from images.lumacdn.com)',
    },
  },

  request: {
    url: 'https://public-api.luma.com/v1/event/create',
    method: 'POST',
    headers: (params) => ({
      'x-luma-api-key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        start_at: params.startAt,
        timezone: params.timezone,
      }
      if (params.endAt) body.end_at = params.endAt
      if (params.durationInterval) body.duration_interval = params.durationInterval
      if (params.descriptionMd) body.description_md = params.descriptionMd
      if (params.meetingUrl) body.meeting_url = params.meetingUrl
      if (params.visibility) body.visibility = params.visibility
      if (params.coverUrl) body.cover_url = params.coverUrl
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to create event')
    }

    const event = data.event
    const hosts = (data.hosts ?? []).map((h: Record<string, unknown>) => ({
      id: (h.id as string) ?? null,
      name: (h.name as string) ?? null,
      firstName: (h.first_name as string) ?? null,
      lastName: (h.last_name as string) ?? null,
      email: (h.email as string) ?? null,
      avatarUrl: (h.avatar_url as string) ?? null,
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
      description: 'Created event details',
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
