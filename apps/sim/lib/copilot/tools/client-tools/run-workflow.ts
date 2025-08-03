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
          displayName: 'Running workflow',
          icon: 'spinner',
        },
        accepted: {
          displayName: 'Running workflow',
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
    try {
      // Parse parameters from either toolCall.parameters or toolCall.input
      const rawParams = toolCall.parameters || toolCall.input || {}
      const params = rawParams as RunWorkflowParams

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

      // Note: toolCall.state is already set to 'executing' by clientAcceptTool

      // Use the standalone execution utility with full logging support
      // This works for both deployed and non-deployed workflows
      const result = await executeWorkflowWithFullLogging({
        workflowInput,
        executionId: toolCall.id, // Use tool call ID as execution ID
      })

      // Reset execution state
      setIsExecuting(false)

      // Check if execution was successful
      if (result && (!('success' in result) || result.success !== false)) {
        // Notify server of success
        await this.notify(toolCall.id, 'success', 'Workflow execution completed successfully')

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

      // Notify server of error
      await this.notify(toolCall.id, 'errored', `Workflow execution failed: ${errorMessage}`)

      options?.onStateChange?.('errored')

      return {
        success: false,
        error: errorMessage,
      }
    } catch (error: any) {
      // Reset execution state in case of error
      const { setIsExecuting } = useExecutionStore.getState()
      setIsExecuting(false)

      const errorMessage = error?.message || 'An unknown error occurred'

      await this.notify(toolCall.id, 'errored', `Workflow execution failed: ${errorMessage}`)

      options?.onStateChange?.('errored')

      return {
        success: false,
        error: errorMessage,
      }
    }
  }
}
