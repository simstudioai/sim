import type { ToolConfig } from '@/tools/types'

interface PostHogListEventDefinitionsParams {
  projectId: string
  region: 'us' | 'eu'
  apiKey: string
  limit?: number
  offset?: number
  search?: string
}

interface EventDefinition {
  id: string
  name: string
  description: string
  tags: string[]
  volume_30_day: number | null
  query_usage_30_day: number | null
  created_at: string
  last_seen_at: string | null
  updated_at: string
  updated_by: {
    id: number
    uuid: string
    distinct_id: string
    first_name: string
    email: string
  } | null
}

interface PostHogListEventDefinitionsResponse {
  count: number
  next: string | null
  previous: string | null
  results: EventDefinition[]
}

export const listEventDefinitionsTool: ToolConfig<
  PostHogListEventDefinitionsParams,
  PostHogListEventDefinitionsResponse
> = {
  id: 'posthog_list_event_definitions',
  name: 'PostHog List Event Definitions',
  description:
    'List all event definitions in a PostHog project. Event definitions represent tracked events with metadata like descriptions, tags, and usage statistics.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostHog Project ID (e.g., "12345" or project UUID)',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog cloud region: us or eu',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog Personal API Key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return per page (default: 100, e.g., 10, 50, 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The initial index from which to return results (e.g., 0, 100, 200)',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter event definitions by name',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      const queryParams = new URLSearchParams()

      if (params.limit) queryParams.append('limit', params.limit.toString())
      if (params.offset) queryParams.append('offset', params.offset.toString())
      if (params.search) queryParams.append('search', params.search)

      const query = queryParams.toString()
      return `${baseUrl}/api/projects/${params.projectId}/event_definitions/${query ? `?${query}` : ''}`
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
      count: data.count,
      next: data.next ?? null,
      previous: data.previous ?? null,
      results: data.results.map((event: any) => ({
        id: event.id,
        name: event.name,
        description: event.description || '',
        tags: event.tags || [],
        volume_30_day: event.volume_30_day ?? null,
        query_usage_30_day: event.query_usage_30_day ?? null,
        created_at: event.created_at,
        last_seen_at: event.last_seen_at ?? null,
        updated_at: event.updated_at,
        updated_by: event.updated_by ?? null,
      })),
    }
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Total number of event definitions',
    },
    next: {
      type: 'string',
      description: 'URL for the next page of results',
      optional: true,
    },
    previous: {
      type: 'string',
      description: 'URL for the previous page of results',
      optional: true,
    },
    results: {
      type: 'array',
      description: 'List of event definitions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the event definition' },
          name: { type: 'string', description: 'Event name' },
          description: { type: 'string', description: 'Event description' },
          tags: { type: 'array', description: 'Tags associated with the event' },
          volume_30_day: {
            type: 'number',
            description: 'Number of events received in the last 30 days',
            optional: true,
          },
          query_usage_30_day: {
            type: 'number',
            description: 'Number of times this event was queried in the last 30 days',
            optional: true,
          },
          created_at: { type: 'string', description: 'ISO timestamp when the event was created' },
          last_seen_at: {
            type: 'string',
            description: 'ISO timestamp when the event was last seen',
            optional: true,
          },
          updated_at: { type: 'string', description: 'ISO timestamp when the event was updated' },
          updated_by: {
            type: 'object',
            description: 'User who last updated the event',
            optional: true,
          },
        },
      },
    },
  },
}
