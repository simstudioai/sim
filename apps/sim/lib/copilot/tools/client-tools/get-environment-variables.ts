/**
 * Get Environment Variables - Client-side wrapper that posts to methods route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export class GetEnvironmentVariablesClientTool extends BaseTool {
  static readonly id = 'get_environment_variables'

  metadata: ToolMetadata = {
    id: GetEnvironmentVariablesClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Getting environment variables', icon: 'spinner' },
        success: { displayName: 'Found environment variables', icon: 'wrench' },
        rejected: { displayName: 'Skipped viewing environment variables', icon: 'skip' },
        errored: { displayName: 'Failed to get environment variables', icon: 'error' },
        aborted: { displayName: 'Environment variables viewing aborted', icon: 'abort' },
      },
    },
    schema: {
      name: GetEnvironmentVariablesClientTool.id,
      description: 'Get environment variables for the active workflow/user',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'Optional workflow ID' },
        },
        required: [],
      },
    },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('GetEnvironmentVariablesClientTool')

    try {
      options?.onStateChange?.('executing')

      // Prefer provided param if any; else use active workflowId
      const provided = (toolCall.parameters || toolCall.input || {}) as Record<string, any>
      let workflowId: string | undefined = provided.workflowId
      if (!workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        workflowId = activeWorkflowId || undefined
      }

      logger.info('Posting get_environment_variables to methods route', {
        toolCallId: toolCall.id,
        methodId: 'get_environment_variables',
        hasWorkflowId: !!workflowId,
      })

      const response = await fetch('/api/copilot/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          methodId: 'get_environment_variables',
          params: { ...(workflowId ? { workflowId } : {}) },
          toolId: toolCall.id,
        }),
      })

      logger.info('Methods route response received', {
        ok: response.ok,
        status: response.status,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        options?.onStateChange?.('errored')
        return { success: false, error: errorData?.error || 'Failed to execute server method' }
      }

      const result = await response.json()
      logger.info('Methods route parsed JSON', {
        success: result?.success,
        hasData: !!result?.data,
      })

      if (!result.success) {
        options?.onStateChange?.('errored')
        return { success: false, error: result.error || 'Server method execution failed' }
      }

      options?.onStateChange?.('success')
      return { success: true, data: result.data }
    } catch (error: any) {
      logger.error('Error in client tool execution:', {
        toolCallId: toolCall.id,
        error: error,
        message: error instanceof Error ? error.message : String(error),
      })
      options?.onStateChange?.('errored')
      return { success: false, error: error.message || 'Failed to get environment variables' }
    }
  }
} 