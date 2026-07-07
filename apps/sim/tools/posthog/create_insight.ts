import { getPostHogAppBaseUrl } from '@/tools/posthog/utils'
import type { ToolConfig } from '@/tools/types'

interface PostHogCreateInsightParams {
  apiKey: string
  projectId: string
  region: string
  host?: string
  name: string
  description?: string
  query?: string
  dashboards?: string
  tags?: string
}

interface PostHogCreateInsightResponse {
  success: boolean
  output: {
    id: number
    name: string
    description: string
    query: Record<string, any> | null
    created_at: string
    created_by: Record<string, any> | null
    last_modified_at: string
    dashboards: number[]
    tags: string[]
  }
}

export const createInsightTool: ToolConfig<
  PostHogCreateInsightParams,
  PostHogCreateInsightResponse
> = {
  id: 'posthog_create_insight',
  name: 'PostHog Create Insight',
  description: 'Create a new insight in PostHog. Requires insight name and a query configuration.',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name for the insight (optional - PostHog will generate a derived name if not provided)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the insight',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON string of query configuration for the insight',
    },
    dashboards: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of dashboard IDs to add this insight to',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags for the insight',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getPostHogAppBaseUrl(params.region as 'us' | 'eu' | undefined, params.host)
      return `${baseUrl}/api/projects/${params.projectId}/insights/`
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

      if (params.query) {
        try {
          body.query = JSON.parse(params.query)
        } catch (e) {
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
        query: data.query || null,
        created_at: data.created_at,
        created_by: data.created_by || null,
        last_modified_at: data.last_modified_at,
        dashboards: data.dashboards || [],
        tags: data.tags || [],
      },
    }
  },

  outputs: {
    id: {
      type: 'number',
      description: 'Unique identifier for the created insight',
    },
    name: {
      type: 'string',
      description: 'Name of the insight',
    },
    description: {
      type: 'string',
      description: 'Description of the insight',
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
    dashboards: {
      type: 'array',
      description: 'IDs of dashboards this insight appears on',
    },
    tags: {
      type: 'array',
      description: 'Tags associated with the insight',
    },
  },
}
