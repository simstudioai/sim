import type { ToolConfig } from '@/tools/types'

interface PostHogListInsightsParams {
  apiKey: string
  projectId: string
  region: string
  limit?: number
  offset?: number
}

interface PostHogListInsightsResponse {
  success: boolean
  output: {
    count: number
    next: string | null
    previous: string | null
    results: Array<{
      id: number
      name: string
      description: string
      filters: Record<string, any>
      query: Record<string, any> | null
      created_at: string
      created_by: Record<string, any> | null
      last_modified_at: string
      last_modified_by: Record<string, any> | null
      saved: boolean
      dashboards: number[]
    }>
  }
}

export const listInsightsTool: ToolConfig<PostHogListInsightsParams, PostHogListInsightsResponse> =
  {
    id: 'posthog_list_insights',
    name: 'PostHog List Insights',
    description:
      'List all insights in a PostHog project. Returns insight configurations, filters, and metadata.',
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
        let url = `${baseUrl}/api/projects/${params.projectId}/insights/`

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
          results: (data.results || []).map((insight: any) => ({
            id: insight.id,
            name: insight.name || '',
            description: insight.description || '',
            filters: insight.filters || {},
            query: insight.query || null,
            created_at: insight.created_at,
            created_by: insight.created_by || null,
            last_modified_at: insight.last_modified_at,
            last_modified_by: insight.last_modified_by || null,
            saved: insight.saved || false,
            dashboards: insight.dashboards || [],
          })),
        },
      }
    },

    outputs: {
      count: {
        type: 'number',
        description: 'Total number of insights in the project',
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
        description: 'List of insights with their configurations and metadata',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Unique identifier for the insight' },
            name: { type: 'string', description: 'Name of the insight' },
            description: { type: 'string', description: 'Description of the insight' },
            filters: { type: 'object', description: 'Filter configuration for the insight' },
            query: { type: 'object', description: 'Query configuration for the insight' },
            created_at: { type: 'string', description: 'ISO timestamp when insight was created' },
            created_by: { type: 'object', description: 'User who created the insight' },
            last_modified_at: {
              type: 'string',
              description: 'ISO timestamp when insight was last modified',
            },
            last_modified_by: { type: 'object', description: 'User who last modified the insight' },
            saved: { type: 'boolean', description: 'Whether the insight is saved' },
            dashboards: {
              type: 'array',
              description: 'IDs of dashboards this insight appears on',
            },
          },
        },
      },
    },
  }
