import type { ToolConfig } from '@/tools/types'
import type { ZapierExecuteActionParams, ZapierExecuteActionResponse } from '@/tools/zapier/types'

export const zapierExecuteActionTool: ToolConfig<
  ZapierExecuteActionParams,
  ZapierExecuteActionResponse
> = {
  id: 'zapier_execute_action',
  name: 'Zapier Execute Action',
  description:
    'Execute a stored AI Action in Zapier. Runs any of the 30,000+ actions across 7,000+ apps that Zapier supports.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zapier AI Actions API key from actions.zapier.com/credentials',
    },
    actionId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the AI Action to execute',
    },
    instructions: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Plain English instructions for what the action should do (e.g., "Send a message about the weekly report to #general")',
    },
    params: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional parameter constraints. Each key maps to {mode: "locked"|"guess"|"choose_from"|"ignored", value: string}',
    },
    previewOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, preview the execution without actually running it',
      default: false,
    },
  },

  request: {
    url: (params) =>
      `https://actions.zapier.com/api/v2/ai-actions/${encodeURIComponent(params.actionId)}/execute${params.previewOnly ? '?preview_only=true' : ''}`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        instructions: params.instructions,
      }
      if (params.params !== undefined) {
        body.params = params.params
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
      error: errorMessage, // Top-level error for the framework to capture
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
      description: 'Unique identifier for this execution (can be used for feedback)',
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
