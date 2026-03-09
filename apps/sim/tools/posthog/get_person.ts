import type { ToolConfig } from '@/tools/types'

export interface PostHogGetPersonParams {
  personalApiKey: string
  region?: 'us' | 'eu'
  projectId: string
  personId: string
}

export interface PostHogGetPersonResponse {
  success: boolean
  output: {
    person: {
      id: string
      name: string
      distinct_ids: string[]
      properties: Record<string, any>
      created_at: string
      uuid: string
    }
  }
}

export const getPersonTool: ToolConfig<PostHogGetPersonParams, PostHogGetPersonResponse> = {
  id: 'posthog_get_person',
  name: 'PostHog Get Person',
  description: 'Get detailed information about a specific person in PostHog by their ID or UUID.',
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
    personId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Person ID or UUID to retrieve (e.g., "01234567-89ab-cdef-0123-456789abcdef")',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/persons/${params.personId}/`
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
          person: {
            id: '',
            name: '',
            distinct_ids: [],
            properties: {},
            created_at: '',
            uuid: '',
          },
        },
        error: error || 'Failed to get person',
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        person: {
          id: data.id,
          name: data.name || '',
          distinct_ids: data.distinct_ids || [],
          properties: data.properties || {},
          created_at: data.created_at,
          uuid: data.uuid,
        },
      },
    }
  },

  outputs: {
    person: {
      type: 'object',
      description: 'Person details including properties and identifiers',
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
}
