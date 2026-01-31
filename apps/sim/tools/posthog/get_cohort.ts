import type { ToolConfig } from '@/tools/types'

interface PostHogGetCohortParams {
  apiKey: string
  projectId: string
  cohortId: string
  region: string
}

interface PostHogGetCohortResponse {
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
    last_calculation: string
    errors_calculating: number
    count: number
    is_static: boolean
    version: number
  }
}

export const getCohortTool: ToolConfig<PostHogGetCohortParams, PostHogGetCohortResponse> = {
  id: 'posthog_get_cohort',
  name: 'PostHog Get Cohort',
  description:
    'Get a specific cohort by ID from PostHog. Returns detailed cohort definition, filters, and user count.',
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
    cohortId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The cohort ID to retrieve (e.g., "42")',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'PostHog cloud region: "us" or "eu" (default: "us")',
      default: 'us',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/cohorts/${params.cohortId}/`
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
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
        last_calculation: data.last_calculation || '',
        errors_calculating: data.errors_calculating || 0,
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
    created_by: {
      type: 'object',
      description: 'User who created the cohort',
      optional: true,
    },
    is_calculating: {
      type: 'boolean',
      description: 'Whether the cohort is being calculated',
    },
    last_calculation: {
      type: 'string',
      description: 'ISO timestamp of last calculation',
    },
    errors_calculating: {
      type: 'number',
      description: 'Number of errors during calculation',
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
