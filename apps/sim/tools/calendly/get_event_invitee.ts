import type {
  CalendlyGetEventInviteeParams,
  CalendlyGetEventInviteeResponse,
} from '@/tools/calendly/types'
import { toUuid } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

export const getEventInviteeTool: ToolConfig<
  CalendlyGetEventInviteeParams,
  CalendlyGetEventInviteeResponse
> = {
  id: 'calendly_get_event_invitee',
  name: 'Calendly Get Event Invitee',
  description: 'Retrieve a single invitee of a scheduled event, including their intake answers',
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
    inviteeUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Invitee UUID. Format: UUID (e.g., "abc123-def456") or full invitee URI (e.g., "https://api.calendly.com/scheduled_events/abc123/invitees/def456")',
    },
  },

  request: {
    url: (params: CalendlyGetEventInviteeParams) =>
      `https://api.calendly.com/scheduled_events/${toUuid(params.eventUuid)}/invitees/${toUuid(params.inviteeUuid)}`,
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
      description: 'Invitee details',
      properties: {
        uri: { type: 'string', description: 'Canonical reference to the invitee' },
        email: { type: 'string', description: 'Invitee email address' },
        name: { type: 'string', description: 'Invitee full name' },
        first_name: { type: 'string', description: 'Invitee first name' },
        last_name: { type: 'string', description: 'Invitee last name' },
        status: { type: 'string', description: 'Invitee status (active or canceled)' },
        timezone: { type: 'string', description: 'Invitee timezone' },
        event: { type: 'string', description: 'URI of the scheduled event' },
        created_at: { type: 'string', description: 'ISO timestamp when invitee was created' },
        updated_at: { type: 'string', description: 'ISO timestamp when invitee was updated' },
        cancel_url: { type: 'string', description: 'URL to cancel the booking' },
        reschedule_url: { type: 'string', description: 'URL to reschedule the booking' },
        rescheduled: { type: 'boolean', description: 'Whether the invitee rescheduled' },
        text_reminder_number: {
          type: 'string',
          description: 'Phone number used for SMS reminders',
        },
        routing_form_submission: {
          type: 'string',
          description: 'URI of the routing form submission that produced this booking',
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
        tracking: {
          type: 'object',
          description: 'UTM and Salesforce tracking parameters captured at booking',
          properties: {
            utm_campaign: { type: 'string', description: 'UTM campaign' },
            utm_source: { type: 'string', description: 'UTM source' },
            utm_medium: { type: 'string', description: 'UTM medium' },
            utm_content: { type: 'string', description: 'UTM content' },
            utm_term: { type: 'string', description: 'UTM term' },
            salesforce_uuid: { type: 'string', description: 'Salesforce record identifier' },
          },
        },
        cancellation: {
          type: 'object',
          description: 'Cancellation details when the invitee has canceled',
          optional: true,
          properties: {
            canceled_by: { type: 'string', description: 'Name of person who canceled' },
            reason: { type: 'string', description: 'Cancellation reason' },
            canceler_type: { type: 'string', description: 'Type of canceler (host or invitee)' },
            created_at: { type: 'string', description: 'ISO timestamp of the cancellation' },
          },
        },
        no_show: {
          type: 'object',
          description: 'No-show record when the invitee has been marked as a no-show',
          optional: true,
          properties: {
            uri: { type: 'string', description: 'Canonical reference to the no-show' },
            created_at: { type: 'string', description: 'ISO timestamp when marked as no-show' },
          },
        },
        payment: {
          type: 'object',
          description: 'Payment collected at booking',
          optional: true,
          properties: {
            external_id: { type: 'string', description: 'Payment identifier at the provider' },
            provider: { type: 'string', description: 'Payment provider' },
            amount: { type: 'number', description: 'Amount charged' },
            currency: { type: 'string', description: 'Currency code' },
            terms: { type: 'string', description: 'Payment terms' },
            successful: { type: 'boolean', description: 'Whether the payment succeeded' },
          },
        },
      },
    },
  },
}
