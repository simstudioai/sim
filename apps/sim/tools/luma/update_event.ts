import type { LumaUpdateEventParams, LumaUpdateEventResponse } from '@/tools/luma/types'
import {
  LUMA_EVENT_OUTPUT_PROPERTIES,
  LUMA_HOST_OUTPUT_PROPERTIES,
  lumaEventStub,
} from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const updateEventTool: ToolConfig<LumaUpdateEventParams, LumaUpdateEventResponse> = {
  id: 'luma_update_event',
  name: 'Luma Update Event',
  description:
    'Update an existing Luma event. Only the fields you provide will be changed; all other fields remain unchanged.',
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
      description: 'Event ID to update (starts with evt-)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event name/title',
    },
    startAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New start time in ISO 8601 format (e.g., 2025-03-15T18:00:00Z)',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New IANA timezone (e.g., America/New_York, Europe/London)',
    },
    endAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New end time in ISO 8601 format (e.g., 2025-03-15T20:00:00Z)',
    },
    durationInterval: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New duration as ISO 8601 interval (e.g., PT2H for 2 hours). Used if endAt is not provided.',
    },
    descriptionMd: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event description in Markdown format',
    },
    meetingUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New virtual meeting URL (e.g., Zoom, Google Meet link)',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New visibility: public, members-only, or private',
    },
    coverUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New cover image URL (must be a Luma CDN URL from images.lumacdn.com)',
    },
  },

  request: {
    url: 'https://public-api.luma.com/v1/event/update',
    method: 'POST',
    headers: (params) => ({
      'x-luma-api-key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        event_id: params.eventId.trim(),
      }
      if (params.name) body.name = params.name
      if (params.startAt) body.start_at = params.startAt
      if (params.timezone) body.timezone = params.timezone
      if (params.endAt) body.end_at = params.endAt
      if (params.durationInterval) body.duration_interval = params.durationInterval
      if (params.descriptionMd) body.description_md = params.descriptionMd
      if (params.meetingUrl) body.meeting_url = params.meetingUrl
      if (params.visibility) body.visibility = params.visibility
      if (params.coverUrl) body.cover_url = params.coverUrl
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to update event')
    }

    return {
      success: true,
      output: {
        event: lumaEventStub(params?.eventId?.trim() ?? null),
        hosts: [],
      },
    }
  },

  postProcess: async (result, params, executeTool) => {
    const eventId = result.success ? result.output.event.id : null
    if (!eventId) return result

    const full = await executeTool('luma_get_event', {
      apiKey: params.apiKey,
      eventId,
    })
    if (full.success && full.output?.event) {
      return full as LumaUpdateEventResponse
    }
    return result
  },

  outputs: {
    event: {
      type: 'object',
      description: 'Updated event details',
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
