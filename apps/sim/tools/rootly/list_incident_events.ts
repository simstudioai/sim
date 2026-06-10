import type {
  RootlyListIncidentEventsParams,
  RootlyListIncidentEventsResponse,
} from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListIncidentEventsTool: ToolConfig<
  RootlyListIncidentEventsParams,
  RootlyListIncidentEventsResponse
> = {
  id: 'rootly_list_incident_events',
  name: 'Rootly List Incident Events',
  description: 'List the timeline events for a Rootly incident.',
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
      description: 'The ID of the incident',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items per page (default: 20)',
    },
    pageNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.pageSize) queryParams.set('page[size]', String(params.pageSize))
      if (params.pageNumber) queryParams.set('page[number]', String(params.pageNumber))
      const qs = queryParams.toString()
      return `https://api.rootly.com/v1/incidents/${params.incidentId.trim()}/events${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { events: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const events = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      return {
        id: item.id ?? null,
        event: (attrs.event as string) ?? '',
        visibility: (attrs.visibility as string) ?? null,
        occurredAt: (attrs.occurred_at as string) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
      }
    })

    return {
      success: true,
      output: {
        events,
        totalCount: data.meta?.total_count ?? events.length,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of incident timeline events',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique event ID' },
          event: { type: 'string', description: 'The event description' },
          visibility: { type: 'string', description: 'Event visibility (internal or external)' },
          occurredAt: { type: 'string', description: 'When the event occurred' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of events returned',
    },
  },
}
