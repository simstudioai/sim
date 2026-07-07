import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface PostHogUpdateInsightParams {
  apiKey: string
  projectId: string
  insightId: string
  region?: 'us' | 'eu'
  host?: string
  name?: string
  description?: string
  filters?: string
  query?: string
  dashboards?: string
  tags?: string
  favorited?: boolean
}

interface PostHogUpdateInsightResponse {
  success: boolean
  output: {
    id: number
    name: string
    description: string
    filters: Record<string, any>
    query: Record<string, any> | null
    created_at: string
    last_modified_at: string
    saved: boolean
    dashboards: number[]
    tags: string[]
    favorited: boolean
  }
}

export const updateInsightTool: ToolConfig<
  PostHogUpdateInsightParams,
  PostHogUpdateInsightResponse
> = {
  id: 'posthog_update_insight',
  name: 'PostHog Update Insight',
  description:
    'Update an existing insight in PostHog. Can modify name, description, filters, query, dashboards, tags, and favorited status.',
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
    insightId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The insight ID to update (e.g., "42" or short ID like "abc123")',
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
      description: 'Updated name for the insight',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description for the insight',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON string of updated filter configuration for the insight',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON string of updated query configuration for the insight',
    },
    dashboards: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of dashboard IDs to attach this insight to',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags for the insight',
    },
    favorited: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to mark the insight as favorited',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getPostHogAppBaseUrl(params.region, params.host)
      return `${baseUrl}/api/projects/${params.projectId}/insights/${params.insightId}/`
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

      if (params.dashboards) {
        body.dashboards = params.dashboards
          .split(',')
          .map((id: string) => Number(id.trim()))
          .filter((id: number) => !Number.isNaN(id))
      }

      if (params.tags) {
        body.tags = params.tags
          .split(',')
          .map((tag: string) => tag.trim())
          .filter((tag: string) => tag.length > 0)
      }

      if (params.favorited !== undefined) body.favorited = params.favorited

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        output: {
          id: 0,
          name: '',
          description: '',
          filters: {},
          query: null,
          created_at: '',
          last_modified_at: '',
          saved: false,
          dashboards: [],
          tags: [],
          favorited: false,
        },
        error: error || 'Failed to update insight',
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name || '',
        description: data.description || '',
        filters: data.filters || {},
        query: data.query || null,
        created_at: data.created_at,
        last_modified_at: data.last_modified_at,
        saved: data.saved || false,
        dashboards: data.dashboards || [],
        tags: data.tags || [],
        favorited: data.favorited || false,
      },
    }
  },

  outputs: {
    id: {
      type: 'number',
      description: 'Unique identifier for the insight',
    },
    name: {
      type: 'string',
      description: 'Name of the insight',
    },
    description: {
      type: 'string',
      description: 'Description of the insight',
    },
    filters: {
      type: 'object',
      description: 'Filter configuration for the insight',
    },
    query: {
      type: 'object',
      description: 'Query configuration for the insight',
      optional: true,
    },
    created_at: {
      type: 'string',
      description: 'ISO timestamp when insight was created',
    },
    last_modified_at: {
      type: 'string',
      description: 'ISO timestamp when insight was last modified',
    },
    saved: {
      type: 'boolean',
      description: 'Whether the insight is saved',
    },
    dashboards: {
      type: 'array',
      description: 'IDs of dashboards this insight appears on',
    },
    tags: {
      type: 'array',
      description: 'Tags associated with the insight',
    },
    favorited: {
      type: 'boolean',
      description: 'Whether the insight is favorited',
    },
  },
}
