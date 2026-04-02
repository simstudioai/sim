import type {
  RootlyAddIncidentEventParams,
  RootlyAddIncidentEventResponse,
} from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyAddIncidentEventTool: ToolConfig<
  RootlyAddIncidentEventParams,
  RootlyAddIncidentEventResponse
> = {
  id: 'rootly_add_incident_event',
  name: 'Rootly Add Incident Event',
  description: 'Add a timeline event to an existing incident in Rootly.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the incident to add the event to',
    },
    event: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The summary/description of the event',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event visibility (internal or external)',
    },
  },

  request: {
    url: (params) => `https://api.rootly.com/v1/incidents/${params.incidentId.trim()}/events`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const attributes: Record<string, unknown> = {
        event: params.event,
      }
      if (params.visibility) attributes.visibility = params.visibility
      return { data: { type: 'incident_events', attributes } }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          eventId: '',
          event: '',
          visibility: null,
          occurredAt: null,
          createdAt: '',
          updatedAt: '',
        },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const attrs = data.data?.attributes || {}
    return {
      success: true,
      output: {
        eventId: data.data?.id ?? '',
        event: attrs.event ?? '',
        visibility: attrs.visibility ?? null,
        occurredAt: attrs.occurred_at ?? null,
        createdAt: attrs.created_at ?? '',
        updatedAt: attrs.updated_at ?? '',
      },
    }
  },

  outputs: {
    eventId: {
      type: 'string',
      description: 'The ID of the created event',
    },
    event: {
      type: 'string',
      description: 'The event summary',
    },
    visibility: {
      type: 'string',
      description: 'Event visibility (internal or external)',
    },
    occurredAt: {
      type: 'string',
      description: 'When the event occurred',
    },
    createdAt: {
      type: 'string',
      description: 'Creation date',
    },
    updatedAt: {
      type: 'string',
      description: 'Last update date',
    },
  },
}
