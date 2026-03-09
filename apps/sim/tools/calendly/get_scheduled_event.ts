import type {
  CalendlyGetScheduledEventParams,
  CalendlyGetScheduledEventResponse,
} from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const getScheduledEventTool: ToolConfig<
  CalendlyGetScheduledEventParams,
  CalendlyGetScheduledEventResponse
> = {
  id: 'calendly_get_scheduled_event',
  name: 'Calendly Get Scheduled Event',
  description: 'Get detailed information about a specific scheduled event',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    eventUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Scheduled event UUID. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/scheduled_events/abc123-def456")',
    },
  },

  request: {
    url: (params: CalendlyGetScheduledEventParams) => {
      const uuid = params.eventUuid.includes('/')
        ? params.eventUuid.split('/').pop()
        : params.eventUuid
      return `https://api.calendly.com/scheduled_events/${uuid}`
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
      description: 'Scheduled event details',
      properties: {
        uri: { type: 'string', description: 'Canonical reference to the event' },
        name: { type: 'string', description: 'Event name' },
        status: { type: 'string', description: 'Event status (active or canceled)' },
        start_time: { type: 'string', description: 'ISO timestamp of event start' },
        end_time: { type: 'string', description: 'ISO timestamp of event end' },
        event_type: { type: 'string', description: 'URI of the event type' },
        location: {
          type: 'object',
          description: 'Event location details',
          properties: {
            type: { type: 'string', description: 'Location type' },
            location: { type: 'string', description: 'Location description' },
            join_url: { type: 'string', description: 'URL to join online meeting' },
          },
        },
        invitees_counter: {
          type: 'object',
          description: 'Invitee count information',
          properties: {
            total: { type: 'number', description: 'Total number of invitees' },
            active: { type: 'number', description: 'Number of active invitees' },
            limit: { type: 'number', description: 'Maximum number of invitees' },
          },
        },
        event_memberships: {
          type: 'array',
          description: 'Event hosts/members',
          items: {
            type: 'object',
            properties: {
              user: { type: 'string', description: 'User URI' },
              user_email: { type: 'string', description: 'User email' },
              user_name: { type: 'string', description: 'User name' },
            },
          },
        },
        event_guests: {
          type: 'array',
          description: 'Additional guests',
          items: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'Guest email' },
              created_at: { type: 'string', description: 'When guest was added' },
              updated_at: { type: 'string', description: 'When guest info was updated' },
            },
          },
        },
        created_at: { type: 'string', description: 'ISO timestamp of event creation' },
        updated_at: { type: 'string', description: 'ISO timestamp of last update' },
      },
    },
  },
}
