import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface PostHogCreateDashboardParams {
  apiKey: string
  projectId: string
  region?: 'us' | 'eu'
  host?: string
  name: string
  description?: string
  pinned?: boolean
  tags?: string
  useTemplate?: string
}

interface PostHogCreateDashboardResponse {
  success: boolean
  output: {
    id: number
    name: string
    description: string
    pinned: boolean
    created_at: string
    tiles: Array<Record<string, any>>
    filters: Record<string, any>
    tags: string[]
  }
}

export const createDashboardTool: ToolConfig<
  PostHogCreateDashboardParams,
  PostHogCreateDashboardResponse
> = {
  id: 'posthog_create_dashboard',
  name: 'PostHog Create Dashboard',
  description:
    'Create a new dashboard in PostHog. Optionally seed it from a built-in template, then attach insights to it afterward.',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new dashboard',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the dashboard',
    },
    pinned: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to pin the dashboard to the sidebar',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags for the dashboard',
    },
    useTemplate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name of a built-in PostHog dashboard template to seed this dashboard from (e.g., "Product analytics")',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
      return `${baseUrl}/api/projects/${params.projectId}/dashboards/`
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

      if (params.description) body.description = params.description
      if (params.pinned !== undefined) body.pinned = params.pinned
      if (params.useTemplate) body.use_template = params.useTemplate

      if (params.tags) {
        body.tags = params.tags
          .split(',')
          .map((tag: string) => tag.trim())
          .filter((tag: string) => tag.length > 0)
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
        pinned: data.pinned || false,
        created_at: data.created_at,
        tiles: data.tiles || [],
        filters: data.filters || {},
        tags: data.tags || [],
      },
    }
  },

  outputs: {
    id: {
      type: 'number',
      description: 'Unique identifier for the created dashboard',
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
    tiles: {
      type: 'array',
      description: 'Tiles/widgets on the dashboard',
    },
    filters: {
      type: 'object',
      description: 'Global filters applied to the dashboard',
    },
    tags: {
      type: 'array',
      description: 'Tags associated with the dashboard',
    },
  },
}
