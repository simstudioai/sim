/**
 * Run Workflow Tool
 */

import { BaseTool } from '../base-tool'
import type { CopilotToolCall, ToolExecuteResult, ToolMetadata, ToolExecutionOptions } from '../types'

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
          icon: 'play'
        },
        executing: {
          displayName: 'Running workflow',
          icon: 'loader'
        },
        accepted: {
          displayName: 'Running workflow',
          icon: 'play'
        },
        success: {
          displayName: 'Executed workflow',
          icon: 'check'
        },
        rejected: {
          displayName: 'Skipped workflow execution',
          icon: 'skip'
        },
        errored: {
          displayName: 'Failed to execute workflow',
          icon: 'error'
        },
        background: {
          displayName: 'Running workflow in background',
          icon: 'background'
        }
      }
    },
    schema: {
      name: RunWorkflowTool.id,
      description: 'Execute a workflow with optional input',
      parameters: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description: 'The ID of the workflow to run'
          },
          description: {
            type: 'string',
            description: 'Description of what the workflow does'
          },
          workflow_input: {
            type: 'string',
            description: 'Input text to pass to the workflow chat'
          }
        },
        required: []
      }
    },
    requiresInterrupt: true,
    stateMessages: {
      success: 'Workflow successfully executed',
      background: 'User moved workflow exectuion to background. The workflow execution is not complete, but will continue to run in the background.',
      error: 'Error during workflow execution',
      rejected: 'The user chose to skip the workflow execution'
    }
  }

  /**
   * Execute the tool - run the workflow
   * Note: The actual workflow execution is typically handled by the component
   * that uses this tool (e.g., via the executeWorkflow callback in options)
   */
  async execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
    try {
      const params = toolCall.parameters as RunWorkflowParams
      
      // If there's a special workflow execution handler in context, use it
      if (options?.context?.executeWorkflow) {
        const result = await this.executeWithWorkflowHandler(
          params,
          options.context.executeWorkflow,
          options.context
        )
        return result
      }

      // Otherwise, just return success (the UI component handles actual execution)
      console.log('Workflow execution completed for tool call:', toolCall.id)
      
      return {
        success: true,
        data: {
          workflowId: params.workflowId,
          description: params.description,
          message: 'Workflow execution completed successfully'
        }
      }
    } catch (error) {
      console.error('Error in run workflow tool:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Execute workflow with custom handler
   */
  private async executeWithWorkflowHandler(
    params: RunWorkflowParams,
    executeWorkflow: Function,
    context: Record<string, any>
  ): Promise<ToolExecuteResult> {
    try {
      // Check if already executing
      if (context.isExecuting) {
        return {
          success: false,
          error: 'The workflow is already in the middle of an execution. Try again later'
        }
      }

      // Prepare workflow input
      const chatInput = params.workflow_input
      const workflowInput = chatInput && context.conversationId
        ? {
            input: chatInput,
            conversationId: context.conversationId
          }
        : undefined

      // Execute the workflow
      console.log('Executing workflow with input:', workflowInput)
      const result = await executeWorkflow(workflowInput)

      // For chat executions, wait for stream completion
      if (result && 'stream' in result && result.stream) {
        console.log('Chat execution started, waiting for completion...')
        await this.waitForStreamCompletion(result.stream)
        console.log('Chat execution completed')
      }

      return {
        success: true,
        data: {
          workflowId: params.workflowId,
          description: params.description,
          message: 'Workflow execution finished, check console logs to see output'
        }
      }
    } catch (error) {
      console.error('Workflow execution failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute workflow'
      }
    }
  }

  /**
   * Wait for stream to complete
   */
  private async waitForStreamCompletion(stream: ReadableStream): Promise<void> {
    const reader = stream.getReader()
    try {
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
    } finally {
      reader.releaseLock()
    }
  }
} 