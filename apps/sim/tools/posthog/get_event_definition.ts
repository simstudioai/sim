import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface PostHogGetEventDefinitionParams {
  projectId: string
  eventDefinitionId: string
  region: 'us' | 'eu'
  host?: string
  apiKey: string
}

interface EventDefinition {
  id: string
  name: string
  description: string
  tags: string[]
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

export const getEventDefinitionTool: ToolConfig<PostHogGetEventDefinitionParams, EventDefinition> =
  {
    id: 'posthog_get_event_definition',
    name: 'PostHog Get Event Definition',
    description:
      'Get details of a specific event definition in PostHog. Returns comprehensive information about the event including metadata, usage statistics, and verification status.',
    version: '1.0.0',
    errorExtractor: 'posthog-errors',

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
        description: 'Event Definition ID to retrieve',
      },
      region: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PostHog cloud region: us or eu',
      },
      host: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'Self-hosted PostHog instance host (e.g., "posthog.mycompany.com"). Overrides the region setting when provided.',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PostHog Personal API Key',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
        return `${baseUrl}/api/projects/${params.projectId}/event_definitions/${params.eventDefinitionId}`
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
        id: data.id,
        name: data.name,
        description: data.description || '',
        tags: data.tags || [],
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
        description: 'Event description',
      },
      tags: {
        type: 'array',
        description: 'Tags associated with the event',
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
