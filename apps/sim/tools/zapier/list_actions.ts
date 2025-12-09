import type { ToolConfig } from '@/tools/types'
import type { ZapierListActionsParams, ZapierListActionsResponse } from '@/tools/zapier/types'

export const zapierListActionsTool: ToolConfig<ZapierListActionsParams, ZapierListActionsResponse> =
  {
    id: 'zapier_list_actions',
    name: 'Zapier List Actions',
    description:
      'List all AI Actions configured in your Zapier account. Returns stored actions that can be executed.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Zapier AI Actions API key from actions.zapier.com/credentials',
      },
    },

    request: {
      url: 'https://actions.zapier.com/api/v2/ai-actions/',
      method: 'GET',
      headers: (params) => ({
        'Content-Type': 'application/json',
        'x-api-key': params.apiKey,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.detail || `Zapier API error: ${response.status}`)
      }

      // API returns an array of actions and a configuration_link
      const actions = Array.isArray(data) ? data : data.results || []
      const configurationLink = data.configuration_link || 'https://actions.zapier.com/providers/'

      return {
        success: true,
        output: {
          actions: actions.map((action: any) => ({
            id: action.id || '',
            description: action.description || '',
            actionType: action.action_type || '',
            app: action.app || '',
            appLabel: action.meta?.app_label || '',
            action: action.action || '',
            actionLabel: action.meta?.action_label || '',
            params: action.params || {},
            accountId: action.account_id ?? null,
            authenticationId: action.authentication_id ?? null,
            needs: action.needs || null,
          })),
          configurationLink,
        },
      }
    },

    outputs: {
      actions: {
        type: 'json',
        description:
          'Array of configured AI Actions with id, description, actionType, app, appLabel, action, actionLabel, params, accountId, authenticationId, needs',
      },
      configurationLink: {
        type: 'string',
        description: 'Link to configure more actions in Zapier',
      },
    },
  }
