import type { ToolConfig } from '@/tools/types'

interface PostHogGetInsightParams {
  apiKey: string
  projectId: string
  insightId: string
  region: string
}

interface PostHogGetInsightResponse {
  success: boolean
  output: {
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
    tags: string[]
    favorited: boolean
  }
}

export const getInsightTool: ToolConfig<PostHogGetInsightParams, PostHogGetInsightResponse> = {
  id: 'posthog_get_insight',
  name: 'PostHog Get Insight',
  description:
    'Get a specific insight by ID from PostHog. Returns detailed insight configuration, filters, and metadata.',
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
      description: 'The insight ID to retrieve (e.g., "42" or short ID like "abc123")',
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
      return `${baseUrl}/api/projects/${params.projectId}/insights/${params.insightId}/`
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
        filters: data.filters || {},
        query: data.query || null,
        created_at: data.created_at,
        created_by: data.created_by || null,
        last_modified_at: data.last_modified_at,
        last_modified_by: data.last_modified_by || null,
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
    created_by: {
      type: 'object',
      description: 'User who created the insight',
      optional: true,
    },
    last_modified_at: {
      type: 'string',
      description: 'ISO timestamp when insight was last modified',
    },
    last_modified_by: {
      type: 'object',
      description: 'User who last modified the insight',
      optional: true,
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
