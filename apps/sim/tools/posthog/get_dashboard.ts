import type { ToolConfig } from '@/tools/types'

interface PostHogGetDashboardParams {
  apiKey: string
  projectId: string
  dashboardId: string
  region: string
}

interface PostHogGetDashboardResponse {
  success: boolean
  output: {
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
    restriction_level: number
  }
}

export const getDashboardTool: ToolConfig<PostHogGetDashboardParams, PostHogGetDashboardResponse> =
  {
    id: 'posthog_get_dashboard',
    name: 'PostHog Get Dashboard',
    description:
      'Get a specific dashboard by ID from PostHog. Returns detailed dashboard configuration, tiles, and metadata.',
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
      dashboardId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The dashboard ID to retrieve (e.g., "42")',
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
        return `${baseUrl}/api/projects/${params.projectId}/dashboards/${params.dashboardId}/`
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
          pinned: data.pinned || false,
          created_at: data.created_at,
          created_by: data.created_by || null,
          last_modified_at: data.last_modified_at,
          last_modified_by: data.last_modified_by || null,
          tiles: data.tiles || [],
          filters: data.filters || {},
          tags: data.tags || [],
          restriction_level: data.restriction_level || 0,
        },
      }
    },

    outputs: {
      id: {
        type: 'number',
        description: 'Unique identifier for the dashboard',
      },
      name: {
        type: 'string',
        description: 'Name of the dashboard',
      },
      description: {
        type: 'string',
        description: 'Description of the dashboard',
      },
      pinned: {
        type: 'boolean',
        description: 'Whether the dashboard is pinned',
      },
      created_at: {
        type: 'string',
        description: 'ISO timestamp when dashboard was created',
      },
      created_by: {
        type: 'object',
        description: 'User who created the dashboard',
        optional: true,
      },
      last_modified_at: {
        type: 'string',
        description: 'ISO timestamp when dashboard was last modified',
      },
      last_modified_by: {
        type: 'object',
        description: 'User who last modified the dashboard',
        optional: true,
      },
      tiles: {
        type: 'array',
        description: 'Tiles/widgets on the dashboard with their configurations',
      },
      filters: {
        type: 'object',
        description: 'Global filters applied to the dashboard',
      },
      tags: {
        type: 'array',
        description: 'Tags associated with the dashboard',
      },
      restriction_level: {
        type: 'number',
        description: 'Access restriction level for the dashboard',
      },
    },
  }
