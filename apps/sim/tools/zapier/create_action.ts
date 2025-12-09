import type { ToolConfig } from '@/tools/types'
import type { ZapierCreateAiActionParams, ZapierCreateAiActionResponse } from '@/tools/zapier/types'

export const zapierCreateAiActionTool: ToolConfig<
  ZapierCreateAiActionParams,
  ZapierCreateAiActionResponse
> = {
  id: 'zapier_create_action',
  name: 'Zapier Create AI Action',
  description:
    'Create a new stored AI Action in Zapier. The action can then be executed with zapier_execute_action.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zapier AI Actions API key from actions.zapier.com/credentials',
    },
    app: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The app identifier (e.g., "slack", "gmail", "google-docs")',
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
      description: 'Type of action: write, search, or read. Defaults to write.',
      default: 'write',
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
      return `https://actions.zapier.com/api/v2/ai-actions/${query ? `?${query}` : ''}`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
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

    // API response includes: id, description, account_id, authentication_id, app, action, action_type, params, meta, needs
    // Labels come from meta object if available
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
      description: 'The ID of the created AI Action (use this with execute_action)',
    },
    description: {
      type: 'string',
      description: 'Description of the action',
    },
    actionType: {
      type: 'string',
      description:
        'Type of action (write, search, read, read_bulk, search_or_write, search_and_write)',
    },
    app: {
      type: 'string',
      description: 'App identifier',
    },
    appLabel: {
      type: 'string',
      description: 'Human-readable app label from meta',
    },
    action: {
      type: 'string',
      description: 'Action identifier',
    },
    actionLabel: {
      type: 'string',
      description: 'Human-readable action label from meta',
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
