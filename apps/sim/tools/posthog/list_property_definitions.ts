import type { ToolConfig } from '@/tools/types'

interface PostHogListPropertyDefinitionsParams {
  projectId: string
  region: 'us' | 'eu'
  apiKey: string
  limit?: number
  offset?: number
  search?: string
  type?: 'event' | 'person' | 'group'
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
}

interface PostHogListPropertyDefinitionsResponse {
  count: number
  next: string | null
  previous: string | null
  results: PropertyDefinition[]
}

export const listPropertyDefinitionsTool: ToolConfig<
  PostHogListPropertyDefinitionsParams,
  PostHogListPropertyDefinitionsResponse
> = {
  id: 'posthog_list_property_definitions',
  name: 'PostHog List Property Definitions',
  description:
    'List all property definitions in a PostHog project. Property definitions represent tracked properties with metadata like descriptions, tags, types, and usage statistics.',
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
      description: 'Search term to filter property definitions by name',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by property type: event, person, or group',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      const queryParams = new URLSearchParams()

      if (params.limit) queryParams.append('limit', params.limit.toString())
      if (params.offset) queryParams.append('offset', params.offset.toString())
      if (params.search) queryParams.append('search', params.search)
      if (params.type) queryParams.append('type', params.type)

      const query = queryParams.toString()
      return `${baseUrl}/api/projects/${params.projectId}/property_definitions/${query ? `?${query}` : ''}`
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
      results: data.results.map((property: any) => ({
        id: property.id,
        name: property.name,
        description: property.description || '',
        tags: property.tags || [],
        is_numerical: property.is_numerical || false,
        is_seen_on_filtered_events: property.is_seen_on_filtered_events ?? null,
        property_type: property.property_type,
        type: property.type,
        volume_30_day: property.volume_30_day ?? null,
        query_usage_30_day: property.query_usage_30_day ?? null,
        created_at: property.created_at,
        updated_at: property.updated_at,
        updated_by: property.updated_by ?? null,
      })),
    }
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Total number of property definitions',
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
      description: 'List of property definitions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the property definition' },
          name: { type: 'string', description: 'Property name' },
          description: { type: 'string', description: 'Property description' },
          tags: { type: 'array', description: 'Tags associated with the property' },
          is_numerical: { type: 'boolean', description: 'Whether the property is numerical' },
          is_seen_on_filtered_events: {
            type: 'boolean',
            description: 'Whether the property is seen on filtered events',
            optional: true,
          },
          property_type: { type: 'string', description: 'The data type of the property' },
          type: { type: 'string', description: 'Property type: event, person, or group' },
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
        },
      },
    },
  },
}
