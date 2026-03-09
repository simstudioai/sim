import type { ToolConfig } from '@/tools/types'

interface PostHogUpdateEventDefinitionParams {
  projectId: string
  eventDefinitionId: string
  region: 'us' | 'eu'
  apiKey: string
  description?: string
  tags?: string
  verified?: boolean
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
  verified: boolean
  verified_at: string | null
  verified_by: string | null
}

export const updateEventDefinitionTool: ToolConfig<
  PostHogUpdateEventDefinitionParams,
  EventDefinition
> = {
  id: 'posthog_update_event_definition',
  name: 'PostHog Update Event Definition',
  description:
    'Update an event definition in PostHog. Can modify description, tags, and verification status to maintain clean event schemas.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostHog Project ID (e.g., "12345" or project UUID)',
    },
    eventDefinitionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event Definition ID to update',
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
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description for the event',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags to associate with the event',
    },
    verified: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to mark the event as verified',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/event_definitions/${params.eventDefinitionId}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.description !== undefined) {
        body.description = params.description
      }

      if (params.tags) {
        body.tags = params.tags
          .split(',')
          .map((tag: string) => tag.trim())
          .filter((tag: string) => tag.length > 0)
      }

      if (params.verified !== undefined) {
        body.verified = params.verified
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      id: data.id,
      name: data.name,
      description: data.description || '',
      tags: data.tags || [],
      volume_30_day: data.volume_30_day ?? null,
      query_usage_30_day: data.query_usage_30_day ?? null,
      created_at: data.created_at,
      last_seen_at: data.last_seen_at ?? null,
      updated_at: data.updated_at,
      updated_by: data.updated_by ?? null,
      verified: data.verified || false,
      verified_at: data.verified_at ?? null,
      verified_by: data.verified_by ?? null,
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Unique identifier for the event definition',
    },
    name: {
      type: 'string',
      description: 'Event name',
    },
    description: {
      type: 'string',
      description: 'Updated event description',
    },
    tags: {
      type: 'array',
      description: 'Updated tags associated with the event',
    },
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
    created_at: {
      type: 'string',
      description: 'ISO timestamp when the event was created',
    },
    last_seen_at: {
      type: 'string',
      description: 'ISO timestamp when the event was last seen',
      optional: true,
    },
    updated_at: {
      type: 'string',
      description: 'ISO timestamp when the event was updated',
    },
    updated_by: {
      type: 'object',
      description: 'User who last updated the event',
      optional: true,
    },
    verified: {
      type: 'boolean',
      description: 'Whether the event has been verified',
    },
    verified_at: {
      type: 'string',
      description: 'ISO timestamp when the event was verified',
      optional: true,
    },
    verified_by: {
      type: 'string',
      description: 'User who verified the event',
      optional: true,
    },
  },
}
