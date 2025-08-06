/**
 * Get User Workflow Tool - Client-side implementation
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface GetUserWorkflowParams {
  workflowId?: string
  includeMetadata?: boolean
}

export class GetUserWorkflowTool extends BaseTool {
  static readonly id = 'get_user_workflow'

  metadata: ToolMetadata = {
    id: GetUserWorkflowTool.id,
    displayConfig: {
      states: {
        executing: {
          displayName: 'Analyzing your workflow',
          icon: 'spinner',
        },
        accepted: {
          displayName: 'Analyzing your workflow',
          icon: 'spinner',
        },
        success: {
          displayName: 'Workflow analyzed',
          icon: 'workflow',
        },
        rejected: {
          displayName: 'Skipped workflow analysis',
          icon: 'skip',
        },
        errored: {
          displayName: 'Failed to analyze workflow',
          icon: 'error',
        },
        aborted: {
          displayName: 'Aborted workflow analysis',
          icon: 'abort',
        },
      },
    },
    schema: {
      name: GetUserWorkflowTool.id,
      description: 'Get the current workflow state as JSON',
      parameters: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description:
              'The ID of the workflow to fetch (optional, uses active workflow if not provided)',
          },
          includeMetadata: {
            type: 'boolean',
            description: 'Whether to include workflow metadata',
          },
        },
        required: [],
      },
    },
    requiresInterrupt: false, // Client tools handle their own interrupts
    stateMessages: {
      success: 'Successfully retrieved workflow',
      error: 'Failed to retrieve workflow',
      rejected: 'User chose to skip workflow retrieval',
    },
  }

  /**
   * Execute the tool - fetch the workflow from stores and write to Redis
   */
  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('GetUserWorkflowTool')

    logger.info('Starting client tool execution', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    })

    try {
      // Parse parameters
      const rawParams = toolCall.parameters || toolCall.input || {}
      const params = rawParams as GetUserWorkflowParams

      // Get workflow ID - use provided or active workflow
      let workflowId = params.workflowId
      if (!workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (!activeWorkflowId) {
          options?.onStateChange?.('errored')
          return {
            success: false,
            error: 'No active workflow found',
          }
        }
        workflowId = activeWorkflowId
      }

      logger.info('Fetching user workflow from stores', {
        workflowId,
        includeMetadata: params.includeMetadata,
      })

      // Try to get workflow from diff/preview store first, then main store
      let workflowState: any = null

      // Check diff store first
      const diffStore = useWorkflowDiffStore.getState()
      if (diffStore.diffWorkflow && Object.keys(diffStore.diffWorkflow.blocks || {}).length > 0) {
        workflowState = diffStore.diffWorkflow
        logger.info('Using workflow from diff/preview store', { workflowId })
      } else {
        // Get the actual workflow state from the workflow store
        const workflowStore = useWorkflowStore.getState()
        const fullWorkflowState = workflowStore.getWorkflowState()

        if (!fullWorkflowState || !fullWorkflowState.blocks) {
          // Fallback to workflow registry metadata if no workflow state
          const workflowRegistry = useWorkflowRegistry.getState()
          const workflow = workflowRegistry.workflows[workflowId]

          if (!workflow) {
            options?.onStateChange?.('errored')
            return {
              success: false,
              error: `Workflow ${workflowId} not found in any store`,
            }
          }

          logger.warn('No workflow state found, using workflow metadata only', { workflowId })
          workflowState = workflow
        } else {
          workflowState = fullWorkflowState
          logger.info('Using workflow state from workflow store', {
            workflowId,
            blockCount: Object.keys(fullWorkflowState.blocks || {}).length,
          })
        }
      }

      // Ensure workflow state has all required properties with proper defaults
      if (workflowState) {
        if (!workflowState.loops) {
          workflowState.loops = {}
        }
        if (!workflowState.parallels) {
          workflowState.parallels = {}
        }
        if (!workflowState.edges) {
          workflowState.edges = []
        }
        if (!workflowState.blocks) {
          workflowState.blocks = {}
        }
      }

      logger.info('Validating workflow state', {
        workflowId,
        hasWorkflowState: !!workflowState,
        hasBlocks: !!workflowState?.blocks,
        workflowStateType: typeof workflowState,
      })

      if (!workflowState || !workflowState.blocks) {
        logger.error('Workflow state validation failed', {
          workflowId,
          workflowState: workflowState,
          hasBlocks: !!workflowState?.blocks,
        })
        options?.onStateChange?.('errored')
        return {
          success: false,
          error: 'Workflow state is empty or invalid',
        }
      }

      // Include metadata if requested and available
      if (params.includeMetadata && workflowState.metadata) {
        // Metadata is already included in the workflow state
      }

      logger.info('Successfully fetched user workflow from stores', {
        workflowId,
        blockCount: Object.keys(workflowState.blocks || {}).length,
        fromDiffStore:
          !!diffStore.diffWorkflow && Object.keys(diffStore.diffWorkflow.blocks || {}).length > 0,
      })

      logger.info('About to stringify workflow state', {
        workflowId,
        workflowStateKeys: Object.keys(workflowState),
      })

      // Convert workflow state to JSON string
      let workflowJson: string
      try {
        workflowJson = JSON.stringify(workflowState, null, 2)
        logger.info('Successfully stringified workflow state', {
          workflowId,
          jsonLength: workflowJson.length,
        })
      } catch (stringifyError) {
        logger.error('Error stringifying workflow state', {
          workflowId,
          error: stringifyError,
        })
        options?.onStateChange?.('errored')
        return {
          success: false,
          error: `Failed to convert workflow to JSON: ${stringifyError instanceof Error ? stringifyError.message : 'Unknown error'}`,
        }
      }
      logger.info('About to notify server with workflow data', {
        workflowId,
        toolCallId: toolCall.id,
        dataLength: workflowJson.length,
      })

      // Notify server of success with structured data containing userWorkflow
      const structuredData = JSON.stringify({
        userWorkflow: workflowJson,
      })

      logger.info('Calling notify with structured data', {
        toolCallId: toolCall.id,
        structuredDataLength: structuredData.length,
      })

      await this.notify(toolCall.id, 'success', structuredData)

      logger.info('Successfully notified server of success', {
        toolCallId: toolCall.id,
      })

      options?.onStateChange?.('success')

      return {
        success: true,
        data: workflowJson, // Return the same data that goes to Redis
      }
    } catch (error: any) {
      logger.error('Error in client tool execution:', {
        toolCallId: toolCall.id,
        error: error,
        stack: error instanceof Error ? error.stack : undefined,
        message: error instanceof Error ? error.message : String(error),
      })

      try {
        // Notify server of error
        await this.notify(toolCall.id, 'errored', error.message || 'Failed to fetch workflow')
        logger.info('Successfully notified server of error', {
          toolCallId: toolCall.id,
        })
      } catch (notifyError) {
        logger.error('Failed to notify server of error:', {
          toolCallId: toolCall.id,
          notifyError: notifyError,
        })
      }

      options?.onStateChange?.('errored')

      return {
        success: false,
        error: error.message || 'Failed to fetch workflow',
      }
    }
  }
}
