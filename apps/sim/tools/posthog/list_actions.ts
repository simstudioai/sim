import type { ToolConfig } from '@/tools/types'

interface PostHogListActionsParams {
  apiKey: string
  projectId: string
  region: string
  limit?: number
  offset?: number
}

interface PostHogListActionsResponse {
  success: boolean
  output: {
    count: number
    next: string | null
    previous: string | null
    results: Array<{
      id: number
      name: string
      description: string
      tags: string[]
      post_to_slack: boolean
      slack_message_format: string
      steps: Array<Record<string, any>>
      created_at: string
      created_by: Record<string, any> | null
      deleted: boolean
      is_calculating: boolean
      last_calculated_at: string
    }>
  }
}

export const listActionsTool: ToolConfig<PostHogListActionsParams, PostHogListActionsResponse> = {
  id: 'posthog_list_actions',
  name: 'PostHog List Actions',
  description:
    'List all actions in a PostHog project. Returns action definitions, steps, and metadata.',
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
      let url = `${baseUrl}/api/projects/${params.projectId}/actions/`

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
        results: (data.results || []).map((action: any) => ({
          id: action.id,
          name: action.name || '',
          description: action.description || '',
          tags: action.tags || [],
          post_to_slack: action.post_to_slack || false,
          slack_message_format: action.slack_message_format || '',
          steps: action.steps || [],
          created_at: action.created_at,
          created_by: action.created_by || null,
          deleted: action.deleted || false,
          is_calculating: action.is_calculating || false,
          last_calculated_at: action.last_calculated_at || '',
        })),
      },
    }
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Total number of actions in the project',
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
      description: 'List of actions with their definitions and metadata',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Unique identifier for the action' },
          name: { type: 'string', description: 'Name of the action' },
          description: { type: 'string', description: 'Description of the action' },
          tags: { type: 'array', description: 'Tags associated with the action' },
          post_to_slack: {
            type: 'boolean',
            description: 'Whether to post this action to Slack',
          },
          slack_message_format: {
            type: 'string',
            description: 'Format string for Slack messages',
          },
          steps: { type: 'array', description: 'Steps that define the action' },
          created_at: { type: 'string', description: 'ISO timestamp when action was created' },
          created_by: { type: 'object', description: 'User who created the action' },
          deleted: { type: 'boolean', description: 'Whether the action is deleted' },
          is_calculating: {
            type: 'boolean',
            description: 'Whether the action is being calculated',
          },
          last_calculated_at: {
            type: 'string',
            description: 'ISO timestamp of last calculation',
          },
        },
      },
    },
  },
}
