import type { ToolConfig } from '@/tools/types'
import type { ZapierGuessActionsParams, ZapierGuessActionsResponse } from '@/tools/zapier/types'

export const zapierGuessActionsTool: ToolConfig<
  ZapierGuessActionsParams,
  ZapierGuessActionsResponse
> = {
  id: 'zapier_guess_actions',
  name: 'Zapier Guess Actions',
  description:
    'Find relevant Zapier actions using natural language. Searches across 30,000+ actions to find the best matches for your query.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zapier AI Actions API key from actions.zapier.com/credentials',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Natural language description of what you want to do (e.g., "send a Slack message", "create a Google Doc")',
    },
    actionTypes: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description:
        'Types of actions to search for: write, search, read. If not specified, returns all types.',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (default: 25)',
      default: 25,
    },
  },

  request: {
    url: 'https://actions.zapier.com/api/v2/guess-actions/',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
        count: params.count || 25,
      }
      // Only include action_types if explicitly provided (user selected filters)
      // If not provided, API returns all action types
      if (params.actionTypes && params.actionTypes.length > 0) {
        body.action_types = params.actionTypes
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.detail || `Zapier API error: ${response.status}`)
    }

    const actions = Array.isArray(data) ? data : data.results || []

    return {
      success: true,
      output: {
        actions: actions.map((action: any) => ({
          // API returns: app, action, action_type, name (combined), description, image, score
          app: action.app || '',
          action: action.action || '',
          actionType: action.action_type || '',
          name: action.name || '', // Combined app and action name from API
          description: action.description || '',
          image: action.image || '',
          score: action.score || 0,
        })),
      },
    }
  },

  outputs: {
    actions: {
      type: 'json',
      description:
        'Array of matching actions with app, action, actionType, name (combined app/action name), description, image, and score',
    },
  },
}
