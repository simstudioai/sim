import type { ToolConfig } from '@/tools/types'

interface PostHogListCohortsParams {
  apiKey: string
  projectId: string
  region: string
  limit?: number
  offset?: number
}

interface PostHogListCohortsResponse {
  success: boolean
  output: {
    count: number
    next: string | null
    previous: string | null
    results: Array<{
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
    }>
  }
}

export const listCohortsTool: ToolConfig<PostHogListCohortsParams, PostHogListCohortsResponse> = {
  id: 'posthog_list_cohorts',
  name: 'PostHog List Cohorts',
  description:
    'List all cohorts in a PostHog project. Returns cohort definitions, filters, and user counts.',
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
      description: 'Number of results to skip for pagination (e.g., 0, 100, 200)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      let url = `${baseUrl}/api/projects/${params.projectId}/cohorts/`

      const queryParams = []
      if (params.limit) queryParams.push(`limit=${params.limit}`)
      if (params.offset) queryParams.push(`offset=${params.offset}`)

      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`
      }

      return url
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
        count: data.count || 0,
        next: data.next || null,
        previous: data.previous || null,
        results: (data.results || []).map((cohort: any) => ({
          id: cohort.id,
          name: cohort.name || '',
          description: cohort.description || '',
          groups: cohort.groups || [],
          deleted: cohort.deleted || false,
          filters: cohort.filters || {},
          query: cohort.query || null,
          created_at: cohort.created_at,
          created_by: cohort.created_by || null,
          is_calculating: cohort.is_calculating || false,
          last_calculation: cohort.last_calculation || '',
          errors_calculating: cohort.errors_calculating || 0,
          count: cohort.count || 0,
          is_static: cohort.is_static || false,
        })),
      },
    }
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Total number of cohorts in the project',
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
      description: 'List of cohorts with their definitions and metadata',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Unique identifier for the cohort' },
          name: { type: 'string', description: 'Name of the cohort' },
          description: { type: 'string', description: 'Description of the cohort' },
          groups: { type: 'array', description: 'Groups that define the cohort' },
          deleted: { type: 'boolean', description: 'Whether the cohort is deleted' },
          filters: { type: 'object', description: 'Filter configuration for the cohort' },
          query: { type: 'object', description: 'Query configuration for the cohort' },
          created_at: { type: 'string', description: 'ISO timestamp when cohort was created' },
          created_by: { type: 'object', description: 'User who created the cohort' },
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
          count: { type: 'number', description: 'Number of users in the cohort' },
          is_static: { type: 'boolean', description: 'Whether the cohort is static' },
        },
      },
    },
  },
}
