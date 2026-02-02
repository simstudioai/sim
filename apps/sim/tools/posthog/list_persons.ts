import type { ToolConfig } from '@/tools/types'

export interface PostHogListPersonsParams {
  personalApiKey: string
  region?: 'us' | 'eu'
  projectId: string
  limit?: number
  offset?: number
  search?: string
  distinctId?: string
}

export interface PostHogPerson {
  id: string
  name: string
  distinct_ids: string[]
  properties: Record<string, any>
  created_at: string
  uuid: string
}

export interface PostHogListPersonsResponse {
  success: boolean
  output: {
    persons: PostHogPerson[]
    next?: string
  }
}

export const listPersonsTool: ToolConfig<PostHogListPersonsParams, PostHogListPersonsResponse> = {
  id: 'posthog_list_persons',
  name: 'PostHog List Persons',
  description:
    'List persons (users) in PostHog. Returns user profiles with their properties and distinct IDs.',
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
      visibility: 'user-or-llm',
      description: 'PostHog Project ID (e.g., "12345" or project UUID)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of persons to return (default: 100, max: 100)',
      default: 100,
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of persons to skip for pagination (e.g., 0, 100, 200)',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search persons by email, name, or distinct ID',
    },
    distinctId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by specific distinct_id',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      const url = new URL(`${baseUrl}/api/projects/${params.projectId}/persons/`)

      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.offset) url.searchParams.append('offset', params.offset.toString())
      if (params.search) url.searchParams.append('search', params.search)
      if (params.distinctId) url.searchParams.append('distinct_id', params.distinctId)

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
          persons: [],
        },
        error: error || 'Failed to list persons',
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        persons:
          data.results?.map((person: any) => ({
            id: person.id,
            name: person.name || '',
            distinct_ids: person.distinct_ids || [],
            properties: person.properties || {},
            created_at: person.created_at,
            uuid: person.uuid,
          })) || [],
        next: data.next || undefined,
      },
    }
  },

  outputs: {
    persons: {
      type: 'array',
      description: 'List of persons with their properties and identifiers',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Person ID' },
          name: { type: 'string', description: 'Person name' },
          distinct_ids: {
            type: 'array',
            description: 'All distinct IDs associated with this person',
          },
          properties: { type: 'object', description: 'Person properties' },
          created_at: { type: 'string', description: 'When the person was first seen' },
          uuid: { type: 'string', description: 'Person UUID' },
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
