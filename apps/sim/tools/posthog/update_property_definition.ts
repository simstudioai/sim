import type { ToolConfig } from '@/tools/types'

interface PostHogUpdatePropertyDefinitionParams {
  projectId: string
  propertyDefinitionId: string
  region: 'us' | 'eu'
  apiKey: string
  description?: string
  tags?: string
  verified?: boolean
  property_type?: string
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

export const updatePropertyDefinitionTool: ToolConfig<
  PostHogUpdatePropertyDefinitionParams,
  PropertyDefinition
> = {
  id: 'posthog_update_property_definition',
  name: 'PostHog Update Property Definition',
  description:
    'Update a property definition in PostHog. Can modify description, tags, property type, and verification status to maintain clean property schemas.',
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
      description: 'Property Definition ID to update',
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
      description: 'Updated description for the property',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags to associate with the property',
    },
    verified: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to mark the property as verified',
    },
    property_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The data type of the property (e.g., String, Numeric, Boolean, DateTime, etc.)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/property_definitions/${params.propertyDefinitionId}`
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

      if (params.property_type !== undefined) {
        body.property_type = params.property_type
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
      description: 'Updated property description',
    },
    tags: {
      type: 'array',
      description: 'Updated tags associated with the property',
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
