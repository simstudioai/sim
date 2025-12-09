import type { ToolConfig } from '@/tools/types'
import type {
  ZapierStatelessExecuteParams,
  ZapierStatelessExecuteResponse,
} from '@/tools/zapier/types'

export const zapierStatelessExecuteTool: ToolConfig<
  ZapierStatelessExecuteParams,
  ZapierStatelessExecuteResponse
> = {
  id: 'zapier_stateless_execute',
  name: 'Zapier Stateless Execute',
  description:
    'Execute any Zapier action directly without creating a stored AI Action first. Provide the app, action, and instructions.',
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
      description: 'The app to use (e.g., "SlackAPI", "GoogleSheetsV2API", "GmailV2API")',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The action to run (e.g., "direct_message", "add_row", "send_email")',
    },
    instructions: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Plain English instructions about how to run the action (e.g., "Send a message saying hello to #general")',
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
      description:
        'Optional parameter constraints. Each key maps to {mode: "locked"|"guess"|"choose_from"|"ignored", value: any}',
    },
    previewOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, preview the execution without actually running it',
    },
    authenticationId: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Authentication ID for the app connection',
    },
    accountId: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Zapier account ID',
    },
    providerId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Provider ID for AI Actions',
    },
    tokenBudget: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Max tokens per field (default: 1000)',
    },
    skipParamGuessing: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Skip AI parameter guessing',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.previewOnly) {
        queryParams.append('preview_only', 'true')
      }
      if (params.providerId) {
        queryParams.append('provider_id', params.providerId)
      }
      if (params.tokenBudget !== undefined) {
        queryParams.append('token_budget', String(params.tokenBudget))
      }
      if (params.skipParamGuessing) {
        queryParams.append('skip_param_guessing', 'true')
      }
      const query = queryParams.toString()
      return `https://actions.zapier.com/api/v2/execute/${query ? `?${query}` : ''}`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        instructions: params.instructions,
        app: params.app,
        action: params.action,
      }
      if (params.actionType) {
        body.action_type = params.actionType
      }
      if (params.params) {
        body.params = params.params
      }
      if (params.authenticationId !== undefined) {
        body.authentication_id = params.authenticationId
      }
      if (params.accountId !== undefined) {
        body.account_id = params.accountId
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.detail || `Zapier API error: ${response.status}`)
    }

    const isSuccess = data.status === 'success' || data.status === 'preview'
    const errorMessage =
      data.error || (isSuccess ? undefined : `Zapier action ${data.status || 'failed'}`)

    return {
      success: isSuccess,
      error: errorMessage,
      output: {
        executionLogId: data.execution_log_id || '',
        actionUsed: data.action_used || '',
        inputParams: data.input_params || {},
        resolvedParams: data.resolved_params || {},
        results: data.results || [],
        resultFieldLabels: data.result_field_labels || {},
        status: data.status || 'error',
        error: data.error || undefined,
      },
    }
  },

  outputs: {
    executionLogId: {
      type: 'string',
      description: 'Unique identifier for this execution',
    },
    actionUsed: {
      type: 'string',
      description: 'Name of the action that was executed',
    },
    inputParams: {
      type: 'json',
      description: 'Parameters that were passed to the API',
    },
    resolvedParams: {
      type: 'json',
      description: 'Parameters that the AI resolved for execution',
    },
    results: {
      type: 'json',
      description: 'Results from the action execution',
    },
    resultFieldLabels: {
      type: 'json',
      description: 'Human-readable labels for result fields',
    },
    status: {
      type: 'string',
      description: 'Execution status: success, error, empty, preview, or halted',
    },
    error: {
      type: 'string',
      description: 'Error message if execution failed',
      optional: true,
    },
  },
}
