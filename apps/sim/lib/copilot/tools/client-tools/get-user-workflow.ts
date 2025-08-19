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
import { mergeSubblockState } from '@/stores/workflows/utils'
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
   * Execute the tool - fetch the workflow from stores and call the server method
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

      // Merge latest subblock values from the subblock store so subblock edits are reflected
      try {
        if (workflowState?.blocks) {
          workflowState = {
            ...workflowState,
            blocks: mergeSubblockState(workflowState.blocks, workflowId),
          }
          logger.info('Merged subblock values into workflow state', {
            workflowId,
            blockCount: Object.keys(workflowState.blocks || {}).length,
          })
        }
      } catch (mergeError) {
        logger.warn('Failed to merge subblock values; proceeding with raw workflow state', {
          workflowId,
          error: mergeError instanceof Error ? mergeError.message : String(mergeError),
        })
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
          error: `Failed to convert workflow to JSON: ${
            stringifyError instanceof Error ? stringifyError.message : 'Unknown error'
          }`,
        }
      }

      // Post to server to execute server-side tool and complete
      options?.onStateChange?.('executing')
      logger.info('Posting get_user_workflow to methods route', {
        toolCallId: toolCall.id,
        methodId: 'get_user_workflow',
        payloadPreview: workflowJson.substring(0, 200),
        payloadLength: workflowJson.length,
      })
      const response = await fetch('/api/copilot/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          methodId: 'get_user_workflow',
          params: { confirmationMessage: workflowJson, fullData: { userWorkflow: workflowJson } },
          toolId: toolCall.id,
        }),
      })

      logger.info('Methods route response received', {
        ok: response.ok,
        status: response.status,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        logger.error('Methods route returned error', {
          status: response.status,
          error: errorData?.error,
        })
        options?.onStateChange?.('errored')
        return {
          success: false,
          error: errorData?.error || 'Failed to execute server method',
        }
      }

      const result = await response.json()
      logger.info('Methods route parsed JSON', {
        success: result?.success,
        hasData: !!result?.data,
      })
      if (!result.success) {
        options?.onStateChange?.('errored')
        return {
          success: false,
          error: result.error || 'Server method execution failed',
        }
      }

      options?.onStateChange?.('success')
      logger.info('Client tool completed successfully', {
        toolCallId: toolCall.id,
        returnedDataLength: workflowJson.length,
      })
      return {
        success: true,
        data: workflowJson,
      }
    } catch (error: any) {
      logger.error('Error in client tool execution:', {
        toolCallId: toolCall.id,
        error: error,
        stack: error instanceof Error ? error.stack : undefined,
        message: error instanceof Error ? error.message : String(error),
      })

      options?.onStateChange?.('errored')

      return {
        success: false,
        error: error.message || 'Failed to fetch workflow',
      }
    }
  }
}
