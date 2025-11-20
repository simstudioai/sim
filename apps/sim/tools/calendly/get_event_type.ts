import type {
  CalendlyGetEventTypeParams,
  CalendlyGetEventTypeResponse,
} from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const getEventTypeTool: ToolConfig<
  CalendlyGetEventTypeParams,
  CalendlyGetEventTypeResponse
> = {
  id: 'calendly_get_event_type',
  name: 'Calendly Get Event Type',
  description: 'Get detailed information about a specific event type',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    eventTypeUuid: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Event type UUID (can be full URI or just the UUID)',
    },
  },

  request: {
    url: (params: CalendlyGetEventTypeParams) => {
      const uuid = params.eventTypeUuid.includes('/')
        ? params.eventTypeUuid.split('/').pop()
        : params.eventTypeUuid
      return `https://api.calendly.com/event_types/${uuid}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    resource: {
      type: 'object',
      description: 'Event type details',
      properties: {
        uri: { type: 'string', description: 'Canonical reference to the event type' },
        name: { type: 'string', description: 'Event type name' },
        active: { type: 'boolean', description: 'Whether the event type is active' },
        booking_method: { type: 'string', description: 'Booking method' },
        color: { type: 'string', description: 'Hex color code' },
        created_at: { type: 'string', description: 'ISO timestamp of creation' },
        custom_questions: {
          type: 'array',
          description: 'Custom questions for invitees',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Question text' },
              type: {
                type: 'string',
                description: 'Question type (text, single_select, multi_select, etc.)',
              },
              position: { type: 'number', description: 'Question order' },
              enabled: { type: 'boolean', description: 'Whether question is enabled' },
              required: { type: 'boolean', description: 'Whether question is required' },
              answer_choices: {
                type: 'array',
                items: { type: 'string' },
                description: 'Available answer choices',
              },
            },
          },
        },
        description_html: { type: 'string', description: 'HTML formatted description' },
        description_plain: { type: 'string', description: 'Plain text description' },
        duration: { type: 'number', description: 'Duration in minutes' },
        scheduling_url: { type: 'string', description: 'URL to scheduling page' },
        slug: { type: 'string', description: 'Unique identifier for URLs' },
        type: { type: 'string', description: 'Event type classification' },
        updated_at: { type: 'string', description: 'ISO timestamp of last update' },
      },
    },
  },
}
