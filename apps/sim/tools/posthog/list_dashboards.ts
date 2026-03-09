import type { ToolConfig } from '@/tools/types'

interface PostHogListDashboardsParams {
  apiKey: string
  projectId: string
  region: string
  limit?: number
  offset?: number
}

interface PostHogListDashboardsResponse {
  success: boolean
  output: {
    count: number
    next: string | null
    previous: string | null
    results: Array<{
      id: number
      name: string
      description: string
      pinned: boolean
      created_at: string
      created_by: Record<string, any> | null
      last_modified_at: string
      last_modified_by: Record<string, any> | null
      tiles: Array<Record<string, any>>
      filters: Record<string, any>
      tags: string[]
    }>
  }
}

export const listDashboardsTool: ToolConfig<
  PostHogListDashboardsParams,
  PostHogListDashboardsResponse
> = {
  id: 'posthog_list_dashboards',
  name: 'PostHog List Dashboards',
  description:
    'List all dashboards in a PostHog project. Returns dashboard configurations, tiles, and metadata.',
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
      let url = `${baseUrl}/api/projects/${params.projectId}/dashboards/`

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
        results: (data.results || []).map((dashboard: any) => ({
          id: dashboard.id,
          name: dashboard.name || '',
          description: dashboard.description || '',
          pinned: dashboard.pinned || false,
          created_at: dashboard.created_at,
          created_by: dashboard.created_by || null,
          last_modified_at: dashboard.last_modified_at,
          last_modified_by: dashboard.last_modified_by || null,
          tiles: dashboard.tiles || [],
          filters: dashboard.filters || {},
          tags: dashboard.tags || [],
        })),
      },
    }
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Total number of dashboards in the project',
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
      description: 'List of dashboards with their configurations and metadata',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Unique identifier for the dashboard' },
          name: { type: 'string', description: 'Name of the dashboard' },
          description: { type: 'string', description: 'Description of the dashboard' },
          pinned: { type: 'boolean', description: 'Whether the dashboard is pinned' },
          created_at: { type: 'string', description: 'ISO timestamp when dashboard was created' },
          created_by: { type: 'object', description: 'User who created the dashboard' },
          last_modified_at: {
            type: 'string',
            description: 'ISO timestamp when dashboard was last modified',
          },
          last_modified_by: {
            type: 'object',
            description: 'User who last modified the dashboard',
          },
          tiles: { type: 'array', description: 'Tiles/widgets on the dashboard' },
          filters: { type: 'object', description: 'Global filters for the dashboard' },
          tags: { type: 'array', description: 'Tags associated with the dashboard' },
        },
      },
    },
  },
}
