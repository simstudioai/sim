import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface PostHogUpdateCohortParams {
  apiKey: string
  projectId: string
  cohortId: string
  region?: 'us' | 'eu'
  host?: string
  name?: string
  description?: string
  filters?: string
  query?: string
  isStatic?: boolean
  groups?: string
  deleted?: boolean
}

interface PostHogUpdateCohortResponse {
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
    is_calculating: boolean
    count: number
    is_static: boolean
    version: number
  }
}

export const updateCohortTool: ToolConfig<PostHogUpdateCohortParams, PostHogUpdateCohortResponse> =
  {
    id: 'posthog_update_cohort',
    name: 'PostHog Update Cohort',
    description:
      'Update an existing cohort in PostHog. Can modify name, description, filters, query, static membership, and deleted status.',
    version: '1.0.0',
    errorExtractor: 'posthog-errors',

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
      cohortId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The cohort ID to update (e.g., "42")',
      },
      region: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'PostHog cloud region: "us" or "eu" (default: "us")',
        default: 'us',
      },
      host: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'Self-hosted PostHog instance host (e.g., "posthog.mycompany.com"). Overrides the region setting when provided.',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Updated name for the cohort',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Updated description of the cohort',
      },
      filters: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'JSON string of updated filter configuration for the cohort',
      },
      query: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'JSON string of updated query configuration for the cohort',
      },
      isStatic: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the cohort is static',
      },
      groups: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'JSON string of updated groups that define the cohort',
      },
      deleted: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Set to true to archive (soft-delete) the cohort',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
        return `${baseUrl}/api/projects/${params.projectId}/cohorts/${params.cohortId}/`
      },
      method: 'PATCH',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const body: Record<string, any> = {}

        if (params.name !== undefined) body.name = params.name
        if (params.description !== undefined) body.description = params.description

        if (params.filters) {
          try {
            body.filters = JSON.parse(params.filters)
          } catch {
            body.filters = {}
          }
        }

        if (params.query) {
          try {
            body.query = JSON.parse(params.query)
          } catch {
            body.query = null
          }
        }

        if (params.isStatic !== undefined) body.is_static = params.isStatic

        if (params.groups) {
          try {
            body.groups = JSON.parse(params.groups)
          } catch {
            body.groups = []
          }
        }

        if (params.deleted !== undefined) body.deleted = params.deleted

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
        description: 'Unique identifier for the cohort',
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
