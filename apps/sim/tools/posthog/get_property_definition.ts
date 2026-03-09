import type { ToolConfig } from '@/tools/types'

interface PostHogGetPropertyDefinitionParams {
  projectId: string
  propertyDefinitionId: string
  region: 'us' | 'eu'
  apiKey: string
}

interface PropertyDefinition {
  id: string
  name: string
  description: string
  tags: string[]
  is_numerical: boolean
  is_seen_on_filtered_events: boolean | null
  property_type: string
  type: 'event' | 'person' | 'group'
  volume_30_day: number | null
  query_usage_30_day: number | null
  created_at: string
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
  example: string | null
}

export const getPropertyDefinitionTool: ToolConfig<
  PostHogGetPropertyDefinitionParams,
  PropertyDefinition
> = {
  id: 'posthog_get_property_definition',
  name: 'PostHog Get Property Definition',
  description:
    'Get details of a specific property definition in PostHog. Returns comprehensive information about the property including metadata, type, usage statistics, and verification status.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostHog Project ID (e.g., "12345" or project UUID)',
    },
    propertyDefinitionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Property Definition ID to retrieve',
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
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/property_definitions/${params.propertyDefinitionId}`
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
      is_numerical: data.is_numerical || false,
      is_seen_on_filtered_events: data.is_seen_on_filtered_events ?? null,
      property_type: data.property_type,
      type: data.type,
      volume_30_day: data.volume_30_day ?? null,
      query_usage_30_day: data.query_usage_30_day ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
      updated_by: data.updated_by ?? null,
      verified: data.verified || false,
      verified_at: data.verified_at ?? null,
      verified_by: data.verified_by ?? null,
      example: data.example ?? null,
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Unique identifier for the property definition',
    },
    name: {
      type: 'string',
      description: 'Property name',
    },
    description: {
      type: 'string',
      description: 'Property description',
    },
    tags: {
      type: 'array',
      description: 'Tags associated with the property',
    },
    is_numerical: {
      type: 'boolean',
      description: 'Whether the property is numerical',
    },
    is_seen_on_filtered_events: {
      type: 'boolean',
      description: 'Whether the property is seen on filtered events',
      optional: true,
    },
    property_type: {
      type: 'string',
      description: 'The data type of the property',
    },
    type: {
      type: 'string',
      description: 'Property type: event, person, or group',
    },
    volume_30_day: {
      type: 'number',
      description: 'Number of times property was seen in the last 30 days',
      optional: true,
    },
    query_usage_30_day: {
      type: 'number',
      description: 'Number of times this property was queried in the last 30 days',
      optional: true,
    },
    created_at: {
      type: 'string',
      description: 'ISO timestamp when the property was created',
    },
    updated_at: {
      type: 'string',
      description: 'ISO timestamp when the property was updated',
    },
    updated_by: {
      type: 'object',
      description: 'User who last updated the property',
      optional: true,
    },
    verified: {
      type: 'boolean',
      description: 'Whether the property has been verified',
    },
    verified_at: {
      type: 'string',
      description: 'ISO timestamp when the property was verified',
      optional: true,
    },
    verified_by: {
      type: 'string',
      description: 'User who verified the property',
      optional: true,
    },
    example: {
      type: 'string',
      description: 'Example value for the property',
      optional: true,
    },
  },
}
