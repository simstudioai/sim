import type { ToolConfig } from '@/tools/types'

interface PostHogCreateCohortParams {
  apiKey: string
  projectId: string
  region: string
  name: string
  description?: string
  filters?: string
  query?: string
  is_static?: boolean
  groups?: string
}

interface PostHogCreateCohortResponse {
  success: boolean
  output: {
    id: number
    name: string
    description: string
    groups: Array<Record<string, any>>
    deleted: boolean
    filters: Record<string, any>
    query: Record<string, any> | null
    created_at: string
    created_by: Record<string, any> | null
    is_calculating: boolean
    count: number
    is_static: boolean
    version: number
  }
}

export const createCohortTool: ToolConfig<PostHogCreateCohortParams, PostHogCreateCohortResponse> =
  {
    id: 'posthog_create_cohort',
    name: 'PostHog Create Cohort',
    description:
      'Create a new cohort in PostHog. Requires cohort name and filter or query configuration.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PostHog Personal API Key',
      },
      projectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The PostHog project ID (e.g., "12345" or project UUID)',
      },
      region: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'PostHog cloud region: "us" or "eu" (default: "us")',
        default: 'us',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Name for the cohort (optional - PostHog will use "Untitled cohort" if not provided)',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Description of the cohort',
      },
      filters: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'JSON string of filter configuration for the cohort',
      },
      query: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'JSON string of query configuration for the cohort',
      },
      is_static: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the cohort is static (default: false)',
        default: false,
      },
      groups: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'JSON string of groups that define the cohort',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
        return `${baseUrl}/api/projects/${params.projectId}/cohorts/`
      },
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const body: Record<string, any> = {
          name: params.name,
        }

        if (params.description) {
          body.description = params.description
        }

        if (params.filters) {
          try {
            body.filters = JSON.parse(params.filters)
          } catch (e) {
            body.filters = {}
          }
        }

        if (params.query) {
          try {
            body.query = JSON.parse(params.query)
          } catch (e) {
            body.query = null
          }
        }

        if (params.is_static !== undefined) {
          body.is_static = params.is_static
        }

        if (params.groups) {
          try {
            body.groups = JSON.parse(params.groups)
          } catch (e) {
            body.groups = []
          }
        }

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      return {
        success: true,
        output: {
          id: data.id,
          name: data.name || '',
          description: data.description || '',
          groups: data.groups || [],
          deleted: data.deleted || false,
          filters: data.filters || {},
          query: data.query || null,
          created_at: data.created_at,
          created_by: data.created_by || null,
          is_calculating: data.is_calculating || false,
          count: data.count || 0,
          is_static: data.is_static || false,
          version: data.version || 0,
        },
      }
    },

    outputs: {
      id: {
        type: 'number',
        description: 'Unique identifier for the created cohort',
      },
      name: {
        type: 'string',
        description: 'Name of the cohort',
      },
      description: {
        type: 'string',
        description: 'Description of the cohort',
      },
      groups: {
        type: 'array',
        description: 'Groups that define the cohort',
      },
      deleted: {
        type: 'boolean',
        description: 'Whether the cohort is deleted',
      },
      filters: {
        type: 'object',
        description: 'Filter configuration for the cohort',
      },
      query: {
        type: 'object',
        description: 'Query configuration for the cohort',
        optional: true,
      },
      created_at: {
        type: 'string',
        description: 'ISO timestamp when cohort was created',
      },
      created_by: {
        type: 'object',
        description: 'User who created the cohort',
        optional: true,
      },
      is_calculating: {
        type: 'boolean',
        description: 'Whether the cohort is being calculated',
      },
      count: {
        type: 'number',
        description: 'Number of users in the cohort',
      },
      is_static: {
        type: 'boolean',
        description: 'Whether the cohort is static',
      },
      version: {
        type: 'number',
        description: 'Version number of the cohort',
      },
    },
  }
