/**
 * Run Workflow Tool
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { executeWorkflowWithFullLogging } from '@/app/workspace/[workspaceId]/w/[workflowId]/lib/workflow-execution-utils'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { createLogger } from '@/lib/logs/console/logger'

interface RunWorkflowParams {
  workflowId?: string
  description?: string
  workflow_input?: string
}

export class RunWorkflowTool extends BaseTool {
  static readonly id = 'run_workflow'

  metadata: ToolMetadata = {
    id: RunWorkflowTool.id,
    displayConfig: {
      states: {
        pending: {
          displayName: 'Run workflow?',
          icon: 'play',
        },
        executing: {
          displayName: 'Executing workflow',
          icon: 'spinner',
        },
        accepted: {
          displayName: 'Executing workflow',
          icon: 'spinner',
        },
        success: {
          displayName: 'Executed workflow',
          icon: 'play',
        },
        rejected: {
          displayName: 'Skipped workflow execution',
          icon: 'skip',
        },
        errored: {
          displayName: 'Failed to execute workflow',
          icon: 'error',
        },
        background: {
          displayName: 'Workflow execution moved to background',
          icon: 'play',
        },
        aborted: {
          displayName: 'Aborted stream',
          icon: 'abort',
        },
      },
    },
    schema: {
      name: RunWorkflowTool.id,
      description: 'Execute a workflow with optional input',
      parameters: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description: 'The ID of the workflow to run',
          },
          description: {
            type: 'string',
            description: 'Description of what the workflow does',
          },
          workflow_input: {
            type: 'string',
            description: 'Input text to pass to the workflow chat',
          },
        },
        required: [],
      },
    },
    requiresInterrupt: true,
    allowBackgroundExecution: true,
    stateMessages: {
      success: 'Workflow successfully executed',
      background:
        'User moved workflow exectuion to background. The workflow execution is not complete, but will continue to run in the background.',
      error: 'Error during workflow execution',
      rejected: 'The user chose to skip the workflow execution',
    },
  }

  /**
   * Execute the tool - run the workflow
   * This includes showing a background prompt and handling background vs foreground execution
   */
  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('RunWorkflowTool')
    try {
      // Parse parameters from either toolCall.parameters or toolCall.input, support streaming arguments
      const ext = toolCall as CopilotToolCall & { arguments?: any }
      if (ext.arguments && !toolCall.parameters && !toolCall.input) {
        toolCall.input = ext.arguments
        toolCall.parameters = ext.arguments
        logger.info('Mapped arguments to input/parameters', {
          toolCallId: toolCall.id,
        })
      }

      options?.onStateChange?.('executing')

      const rawParams = toolCall.parameters || toolCall.input || {}
      const params = rawParams as RunWorkflowParams

      logger.info('Starting run_workflow execution', {
        toolCallId: toolCall.id,
        hasWorkflowId: !!params.workflowId,
        hasDescription: !!params.description,
        hasInput: !!params.workflow_input,
      })

      // Check if workflow is already executing
      const { isExecuting } = useExecutionStore.getState()
      if (isExecuting) {
        options?.onStateChange?.('errored')
        return {
          success: false,
          error: 'The workflow is already in the middle of an execution. Try again later',
        }
      }

      // Get current workflow and execution context
      const { activeWorkflowId } = useWorkflowRegistry.getState()
      if (!activeWorkflowId) {
        options?.onStateChange?.('errored')
        return {
          success: false,
          error: 'No active workflow found',
        }
      }

      // Prepare workflow input - if workflow_input is provided, pass it to the execution
      const workflowInput = params.workflow_input
        ? {
            input: params.workflow_input,
          }
        : undefined

      // Set execution state
      const { setIsExecuting } = useExecutionStore.getState()
      setIsExecuting(true)

      // Capture the execution timestamp
      const executionStartTime = new Date().toISOString()
      if (options?.context) {
        options.context.executionStartTime = executionStartTime
      }

      // Use the standalone execution utility with full logging support
      const result = await executeWorkflowWithFullLogging({
        workflowInput,
        executionId: toolCall.id, // Use tool call ID as execution ID
      })

      // Reset execution state
      setIsExecuting(false)

      const postCompletion = async (status: 'success' | 'errored' | 'rejected', message: string) => {
        const body = {
          methodId: 'run_workflow',
          params: {
            source: 'run_workflow',
            status,
            message,
            workflowId: params.workflowId || activeWorkflowId,
            description: params.description,
            startedAt: executionStartTime,
            finishedAt: new Date().toISOString(),
          },
          toolCallId: toolCall.id,
          toolId: toolCall.id,
        }
        await fetch('/api/copilot/methods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        })
      }

      // Check if execution was successful
      if (result && (!('success' in result) || result.success !== false)) {
        await postCompletion(
          'success',
          `Workflow execution completed successfully. Started at: ${executionStartTime}`
        )

        options?.onStateChange?.('success')

        return {
          success: true,
          data: {
            workflowId: params.workflowId || activeWorkflowId,
            description: params.description,
            message: 'Workflow execution finished successfully',
          },
        }
      }
      // Execution failed
      const errorMessage = (result as any)?.error || 'Workflow execution failed'
      const failedDependency = (result as any)?.failedDependency

      // Check if failedDependency is true to notify 'rejected' instead of 'errored'
      const targetState = failedDependency === true ? 'rejected' : 'errored'
      const message =
        targetState === 'rejected'
          ? `Workflow execution skipped (failed dependency): ${errorMessage}`
          : `Workflow execution failed: ${errorMessage}`

      await postCompletion(targetState, message)

      options?.onStateChange?.(targetState)

      return {
        success: false,
        error: errorMessage,
      }
    } catch (error: any) {
      // Reset execution state in case of error
      const { setIsExecuting } = useExecutionStore.getState()
      setIsExecuting(false)

      const errorMessage = error?.message || 'An unknown error occurred'
      const failedDependency = error?.failedDependency

      // Check if failedDependency is true to notify 'rejected' instead of 'errored'
      const targetState = failedDependency === true ? 'rejected' : 'errored'

      // Post completion to methods route
      await fetch('/api/copilot/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          methodId: 'run_workflow',
          params: {
            source: 'run_workflow',
            status: targetState,
            message: `Workflow execution failed: ${errorMessage}`,
            finishedAt: new Date().toISOString(),
          },
          toolCallId: toolCall.id,
          toolId: toolCall.id,
        }),
      })

      options?.onStateChange?.(targetState)

      return {
        success: false,
        error: errorMessage,
      }
    }
  }
}
