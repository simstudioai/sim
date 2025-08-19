/**
 * Set Environment Variables - Client-side wrapper that posts to methods route (requires interrupt)
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class SetEnvironmentVariablesClientTool extends BaseTool {
  static readonly id = 'set_environment_variables'

  metadata: ToolMetadata = {
    id: SetEnvironmentVariablesClientTool.id,
    displayConfig: {
      states: {
        pending: { displayName: 'Set environment variables?', icon: 'edit' },
        executing: { displayName: 'Setting environment variables', icon: 'spinner' },
        success: { displayName: 'Set environment variables', icon: 'wrench' },
        rejected: { displayName: 'Skipped setting environment variables', icon: 'skip' },
        errored: { displayName: 'Failed to set environment variables', icon: 'error' },
        background: { displayName: 'Setting moved to background', icon: 'wrench' },
        aborted: { displayName: 'Aborted setting environment variables', icon: 'abort' },
      },
    },
    schema: {
      name: SetEnvironmentVariablesClientTool.id,
      description: 'Set environment variables for the active workflow',
      parameters: {
        type: 'object',
        properties: {
          variables: { type: 'object' },
          workflowId: { type: 'string' },
        },
        required: ['variables'],
      },
    },
    requiresInterrupt: true,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('SetEnvironmentVariablesClientTool')

    try {
      options?.onStateChange?.('executing')
      const ext = toolCall as CopilotToolCall & { arguments?: any }
      if (ext.arguments && !toolCall.parameters && !toolCall.input) {
        toolCall.input = ext.arguments
        toolCall.parameters = ext.arguments
      }
      const provided = toolCall.parameters || toolCall.input || ext.arguments || {}

      const variables = provided.variables || {}
      const workflowId = provided.workflowId

      if (!variables || typeof variables !== 'object' || Object.keys(variables).length === 0) {
        options?.onStateChange?.('errored')
        return { success: false, error: 'variables is required' }
      }

      const requestBody = {
        methodId: 'set_environment_variables',
        params: { variables, ...(workflowId ? { workflowId } : {}) },
        toolCallId: toolCall.id,
        toolId: toolCall.id,
      }

      const response = await fetch('/api/copilot/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        const e = await response.json().catch(() => ({}))
        options?.onStateChange?.('errored')
        return { success: false, error: e?.error || 'Failed to set environment variables' }
      }
      const result = await response.json()
      if (!result.success) {
        options?.onStateChange?.('errored')
        return { success: false, error: result.error || 'Server method failed' }
      }
      options?.onStateChange?.('success')
      return { success: true, data: result.data }
    } catch (error: any) {
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
}
