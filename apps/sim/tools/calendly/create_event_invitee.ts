import type {
  CalendlyCreateEventInviteeParams,
  CalendlyCreateEventInviteeResponse,
} from '@/tools/calendly/types'
import { toResourceUri, toStringArray } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

export const createEventInviteeTool: ToolConfig<
  CalendlyCreateEventInviteeParams,
  CalendlyCreateEventInviteeResponse
> = {
  id: 'calendly_create_event_invitee',
  name: 'Calendly Book Meeting',
  description:
    'Book a meeting by creating an invitee on an event type at a chosen time. Requires a paid Calendly plan',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    eventTypeUri: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Event type to book. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/event_types/abc123-def456")',
    },
    startTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Start time of the booking in UTC. Must be an available slot. Format: ISO 8601 (e.g., "2024-01-15T09:00:00Z")',
    },
    inviteeEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the invitee being booked',
    },
    inviteeTimezone: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invitee timezone. Format: IANA timezone (e.g., "America/New_York")',
    },
    inviteeName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name of the invitee. Required when a first name is not provided',
    },
    inviteeFirstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the invitee. Required when a full name is not provided',
    },
    inviteeLastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the invitee',
    },
    textReminderNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Phone number for SMS reminders. Format: E.164 phone number (e.g., "+14155551234")',
    },
    eventGuests: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Additional guests to copy on the invite. Format: array of email strings (max 10, e.g., ["guest@example.com"])',
    },
  },

  request: {
    url: () => 'https://api.calendly.com/invitees',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: CalendlyCreateEventInviteeParams) => {
      if (!params.inviteeName && !params.inviteeFirstName) {
        throw new Error(
          'Either "inviteeName" or "inviteeFirstName" is required to book a meeting. Please provide the invitee\'s name.'
        )
      }

      const eventGuests = toStringArray(params.eventGuests, 'eventGuests')

      return {
        event_type: toResourceUri(params.eventTypeUri, 'event_types'),
        start_time: params.startTime,
        invitee: {
          email: params.inviteeEmail,
          timezone: params.inviteeTimezone,
          ...(params.inviteeName && { name: params.inviteeName }),
          ...(params.inviteeFirstName && { first_name: params.inviteeFirstName }),
          ...(params.inviteeLastName && { last_name: params.inviteeLastName }),
          ...(params.textReminderNumber && { text_reminder_number: params.textReminderNumber }),
        },
        ...(eventGuests.length > 0 && { event_guests: eventGuests }),
      }
    },
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
      description: 'The invitee created for the booking',
      properties: {
        uri: { type: 'string', description: 'Canonical reference to the invitee' },
        email: { type: 'string', description: 'Invitee email address' },
        name: { type: 'string', description: 'Invitee full name' },
        first_name: { type: 'string', description: 'Invitee first name' },
        last_name: { type: 'string', description: 'Invitee last name' },
        status: { type: 'string', description: 'Invitee status (active or canceled)' },
        timezone: { type: 'string', description: 'Invitee timezone' },
        event: { type: 'string', description: 'URI of the scheduled event that was booked' },
        created_at: { type: 'string', description: 'ISO timestamp when the booking was created' },
        updated_at: { type: 'string', description: 'ISO timestamp when the booking was updated' },
        cancel_url: { type: 'string', description: 'URL to cancel the booking' },
        reschedule_url: { type: 'string', description: 'URL to reschedule the booking' },
        rescheduled: { type: 'boolean', description: 'Whether the invitee rescheduled' },
        text_reminder_number: {
          type: 'string',
          description: 'Phone number used for SMS reminders',
        },
        questions_and_answers: {
          type: 'array',
          description: 'Responses to custom questions',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'Question text' },
              answer: { type: 'string', description: 'Invitee answer' },
              position: { type: 'number', description: 'Question order' },
            },
          },
        },
      },
    },
  },
}
