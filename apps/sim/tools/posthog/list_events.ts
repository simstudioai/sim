import type { ToolConfig } from '@/tools/types'

export interface PostHogListEventsParams {
  personalApiKey: string
  region?: 'us' | 'eu'
  projectId: string
  limit?: number
  offset?: number
  event?: string
  distinctId?: string
  before?: string
  after?: string
}

export interface PostHogEvent {
  id: string
  event: string
  distinct_id: string
  properties: Record<string, any>
  timestamp: string
  person?: {
    id: string
    distinct_ids: string[]
    properties: Record<string, any>
  }
}

export interface PostHogListEventsResponse {
  success: boolean
  output: {
    events: PostHogEvent[]
    next?: string
  }
}

export const listEventsTool: ToolConfig<PostHogListEventsParams, PostHogListEventsResponse> = {
  id: 'posthog_list_events',
  name: 'PostHog List Events',
  description:
    'List events in PostHog. Note: This endpoint is deprecated but kept for backwards compatibility. For production use, prefer the Query endpoint with HogQL.',
  version: '1.0.0',

  params: {
    personalApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog Personal API Key (for authenticated API access)',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'PostHog region: us (default) or eu',
      default: 'us',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog Project ID',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of events to return (default: 100, max: 100)',
      default: 100,
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of events to skip for pagination',
    },
    event: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by specific event name',
    },
    distinctId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by specific distinct_id',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 timestamp - only return events before this time',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 timestamp - only return events after this time',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      const url = new URL(`${baseUrl}/api/projects/${params.projectId}/events/`)

      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.offset) url.searchParams.append('offset', params.offset.toString())
      if (params.event) url.searchParams.append('event', params.event)
      if (params.distinctId) url.searchParams.append('distinct_id', params.distinctId)
      if (params.before) url.searchParams.append('before', params.before)
      if (params.after) url.searchParams.append('after', params.after)

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.personalApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        output: {
          events: [],
        },
        error: error || 'Failed to list events',
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        events:
          data.results?.map((event: any) => ({
            id: event.id,
            event: event.event,
            distinct_id: event.distinct_id,
            properties: event.properties || {},
            timestamp: event.timestamp,
            person: event.person
              ? {
                  id: event.person.id,
                  distinct_ids: event.person.distinct_ids || [],
                  properties: event.person.properties || {},
                }
              : undefined,
          })) || [],
        next: data.next || undefined,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of events with their properties and metadata',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique event ID' },
          event: { type: 'string', description: 'Event name' },
          distinct_id: { type: 'string', description: 'User or device identifier' },
          properties: { type: 'object', description: 'Event properties' },
          timestamp: { type: 'string', description: 'When the event occurred' },
          person: {
            type: 'object',
            description: 'Associated person data',
            properties: {
              id: { type: 'string', description: 'Person ID' },
              distinct_ids: { type: 'array', description: 'All distinct IDs for this person' },
              properties: { type: 'object', description: 'Person properties' },
            },
          },
        },
      },
    },
    next: {
      type: 'string',
      description: 'URL for the next page of results (if available)',
      optional: true,
    },
  },
}
