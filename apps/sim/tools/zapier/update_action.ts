import type { ToolConfig } from '@/tools/types'
import type { ZapierUpdateAiActionParams, ZapierUpdateAiActionResponse } from '@/tools/zapier/types'

export const zapierUpdateAiActionTool: ToolConfig<
  ZapierUpdateAiActionParams,
  ZapierUpdateAiActionResponse
> = {
  id: 'zapier_update_action',
  name: 'Zapier Update AI Action',
  description: 'Update an existing stored AI Action configuration in Zapier.',
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
    actionId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the AI Action to update',
    },
    app: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The app identifier (e.g., "SlackAPI", "GmailV2API")',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The action identifier (e.g., "send_channel_message", "send_email")',
    },
    actionType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Type of action: write, search, read, read_bulk, search_or_write, search_and_write',
    },
    params: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pre-configured parameter values for the action',
    },
    accountId: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Zapier account ID',
    },
    authenticationId: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Authentication ID for the app connection',
    },
    meta: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description:
        'Metadata object with params labels, app_label, action_label, authentication_label, app_needs_auth',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.accountId !== undefined) {
        queryParams.append('account_id', String(params.accountId))
      }
      if (params.authenticationId !== undefined) {
        queryParams.append('authentication_id', String(params.authenticationId))
      }
      const query = queryParams.toString()
      return `https://actions.zapier.com/api/v2/ai-actions/${encodeURIComponent(params.actionId)}/${query ? `?${query}` : ''}`
    },
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params) => ({
      app: params.app,
      action: params.action,
      action_type: params.actionType || 'write',
      params: params.params || {},
      meta: params.meta || { params: {} },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.detail || `Zapier API error: ${response.status}`)
    }

    const appLabel = data.meta?.app_label || ''
    const actionLabel = data.meta?.action_label || ''

    return {
      success: true,
      output: {
        id: data.id || '',
        description: data.description || '',
        actionType: data.action_type || '',
        app: data.app || '',
        appLabel,
        action: data.action || '',
        actionLabel,
        params: data.params || {},
        accountId: data.account_id ?? null,
        authenticationId: data.authentication_id ?? null,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'The ID of the updated AI Action',
    },
    description: {
      type: 'string',
      description: 'Description of the action',
    },
    actionType: {
      type: 'string',
      description: 'Type of action',
    },
    app: {
      type: 'string',
      description: 'App identifier',
    },
    appLabel: {
      type: 'string',
      description: 'Human-readable app label',
    },
    action: {
      type: 'string',
      description: 'Action identifier',
    },
    actionLabel: {
      type: 'string',
      description: 'Human-readable action label',
    },
    params: {
      type: 'json',
      description: 'Configured parameter values',
    },
    accountId: {
      type: 'number',
      description: 'Zapier account ID',
      optional: true,
    },
    authenticationId: {
      type: 'number',
      description: 'Authentication ID used for the app',
      optional: true,
    },
  },
}
