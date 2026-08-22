import type {
  CalendlyCreateSchedulingLinkParams,
  CalendlyCreateSchedulingLinkResponse,
} from '@/tools/calendly/types'
import { toResourceUri } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

/** Calendly only supports single-use links today, so the event count is fixed at one. */
const MAX_EVENT_COUNT = 1

export const createSchedulingLinkTool: ToolConfig<
  CalendlyCreateSchedulingLinkParams,
  CalendlyCreateSchedulingLinkResponse
> = {
  id: 'calendly_create_scheduling_link',
  name: 'Calendly Create Scheduling Link',
  description: 'Create a single-use scheduling link for an event type',
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
        'Event type the link books. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/event_types/abc123-def456")',
    },
  },

  request: {
    url: () => 'https://api.calendly.com/scheduling_links',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: CalendlyCreateSchedulingLinkParams) => ({
      max_event_count: MAX_EVENT_COUNT,
      owner: toResourceUri(params.eventTypeUri, 'event_types'),
      owner_type: 'EventType',
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
      description: 'The created scheduling link',
      properties: {
        booking_url: { type: 'string', description: 'Single-use URL to share with an invitee' },
        owner: { type: 'string', description: 'URI of the event type that owns the link' },
        owner_type: { type: 'string', description: 'Resource type of the owner' },
      },
    },
  },
}
