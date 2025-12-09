import type { ToolConfig } from '@/tools/types'
import type {
  ZapierSearchAppActionsParams,
  ZapierSearchAppActionsResponse,
} from '@/tools/zapier/types'

export const zapierSearchAppActionsTool: ToolConfig<
  ZapierSearchAppActionsParams,
  ZapierSearchAppActionsResponse
> = {
  id: 'zapier_search_app_actions',
  name: 'Zapier Search App Actions',
  description:
    'Search for available actions within a specific Zapier app. Returns all actions the app supports.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'zapier',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Zapier AI Actions API',
    },
    app: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The app identifier to search actions for (e.g., "SlackAPI", "GmailV2API")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional search query to filter actions by name or description',
    },
    actionTypes: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description:
        'Filter by action types: write, search, read, read_bulk, search_or_write, search_and_write. Defaults to write and search.',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.query) {
        queryParams.append('query', params.query)
      }
      if (params.actionTypes && params.actionTypes.length > 0) {
        params.actionTypes.forEach((type: string) => {
          queryParams.append('filter_action_type', type)
        })
      }
      const query = queryParams.toString()
      return `https://actions.zapier.com/api/v2/apps/${encodeURIComponent(params.app)}/actions/${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.detail || `Zapier API error: ${response.status}`)
    }

    const actions = data.results || []

    return {
      success: true,
      output: {
        actions: actions.map((action: any) => ({
          app: action.app || '',
          action: action.action || '',
          actionType: action.type || '',
          displayName: action.display_name || '',
          description: action.description || '',
          relevancyScore: action.search_relevancy_score || 0,
          appNeedsAuth: action.app_needs_auth || false,
          appInfo: action.app_info
            ? {
                app: action.app_info.app || '',
                name: action.app_info.name || '',
                logoUrl: action.app_info.logo_url || '',
                authType: action.app_info.auth_type || '',
              }
            : null,
        })),
      },
    }
  },

  outputs: {
    actions: {
      type: 'json',
      description:
        'Array of actions with app, action, actionType, displayName, description, relevancyScore, appNeedsAuth, appInfo',
    },
  },
}
