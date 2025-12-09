import type { ToolConfig } from '@/tools/types'
import type {
  ZapierGetActionDetailsParams,
  ZapierGetActionDetailsResponse,
} from '@/tools/zapier/types'

export const zapierGetActionDetailsTool: ToolConfig<
  ZapierGetActionDetailsParams,
  ZapierGetActionDetailsResponse
> = {
  id: 'zapier_get_action_details',
  name: 'Zapier Get Action Details',
  description:
    'Get detailed information about a specific action including its required inputs (needs) and outputs (gives).',
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
      visibility: 'user-or-llm',
      description: 'The app identifier (e.g., "SlackAPI", "GmailV2API")',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The action identifier (e.g., "send_channel_message", "send_email")',
    },
    actionType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Type of action: write, search, read. Defaults to write.',
    },
    includeNeeds: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include input requirements (needs). Defaults to true.',
    },
    includeGives: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include output specifications (gives). Defaults to false.',
    },
    includeSample: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include sample execution result. Defaults to false.',
    },
    params: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional params to pass for dynamic field resolution',
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
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.actionType) {
        queryParams.append('action_type', params.actionType)
      }
      if (params.accountId !== undefined) {
        queryParams.append('account_id', String(params.accountId))
      }
      if (params.authenticationId !== undefined) {
        queryParams.append('authentication_id', String(params.authenticationId))
      }
      // Build action_extra array based on flags
      const actionExtra: string[] = []
      if (params.includeNeeds !== false) {
        actionExtra.push('action_needs')
      }
      if (params.includeGives) {
        actionExtra.push('action_gives')
      }
      if (params.includeSample) {
        actionExtra.push('action_sample')
      }
      actionExtra.forEach((extra) => {
        queryParams.append('action_extra', extra)
      })
      const query = queryParams.toString()
      return `https://actions.zapier.com/api/v2/apps/${encodeURIComponent(params.app)}/actions/${encodeURIComponent(params.action)}/${query ? `?${query}` : ''}`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => ({
      params: params.params || {},
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.detail || `Zapier API error: ${response.status}`)
    }

    const results = data.results || []
    const result = results[0] || {}

    // Transform needs array
    const needs = (result.action_needs || []).map((need: any) => ({
      key: need.key || '',
      type: need.type || '',
      label: need.label || '',
      required: need.required || false,
      helpText: need.help_text || '',
      defaultValue: need.default ?? null,
      choices: need.choices || null,
      dependsOn: need.depends_on || null,
      customField: need.custom_field || false,
    }))

    // Transform gives array
    const gives = (result.action_gives || []).map((give: any) => ({
      key: give.key || '',
      label: give.label || '',
      type: give.type || '',
      score: give.score ?? null,
      subscore: give.subscore ?? null,
      important: give.important || false,
      sample: give.zap_meta_sample ?? null,
    }))

    return {
      success: true,
      output: {
        action: result.action
          ? {
              type: result.action.type || '',
              key: result.action.key || '',
              name: result.action.name || '',
              noun: result.action.noun || '',
              description: result.action.description || '',
            }
          : null,
        needs,
        gives,
        sample: result.action_sample || null,
        customNeedsProbability: result.action_has_custom_needs_probability ?? 0,
      },
    }
  },

  outputs: {
    action: {
      type: 'json',
      description: 'Action metadata including type, key, name, noun, and description',
    },
    needs: {
      type: 'json',
      description:
        'Array of input requirements with key, type, label, required, helpText, defaultValue, choices, dependsOn',
    },
    gives: {
      type: 'json',
      description: 'Array of output fields with key, label, type, important, sample',
    },
    sample: {
      type: 'json',
      description: 'Sample execution result if requested',
      optional: true,
    },
    customNeedsProbability: {
      type: 'number',
      description: 'Probability (0-1) that this action has custom/dynamic input fields',
    },
  },
}
