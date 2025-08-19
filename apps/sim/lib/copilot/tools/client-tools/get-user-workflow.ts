/**
 * Get User Workflow Tool - Client-side implementation
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import { postToMethods } from '@/lib/copilot/tools/client-tools/client-utils'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'
import { Serializer } from '@/serializer'
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

      let workflowState: any = null

      const diffStore = useWorkflowDiffStore.getState()
      if (diffStore.diffWorkflow && Object.keys(diffStore.diffWorkflow.blocks || {}).length > 0) {
        workflowState = diffStore.diffWorkflow
        logger.info('Using workflow from diff/preview store', { workflowId })
      } else {
        const workflowStore = useWorkflowStore.getState()
        const fullWorkflowState = workflowStore.getWorkflowState()

        if (!fullWorkflowState || !fullWorkflowState.blocks) {
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

      // Post to server via shared utility
      const result = await postToMethods(
        'get_user_workflow',
        { confirmationMessage: workflowJson, fullData: { userWorkflow: workflowJson } },
        { toolCallId: toolCall.id, toolId: toolCall.id },
        options
      )

      if (!result.success) return result

      try {
        const diffStore = useWorkflowDiffStore.getState()
        const serverData = result.data
        let yamlContent: string | null = null
        if (serverData && typeof serverData === 'object' && (serverData as any).yamlContent) {
          yamlContent = (serverData as any).yamlContent
        } else if (typeof serverData === 'string') {
          const trimmed = serverData.trim()
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(serverData)
              if (parsed && typeof parsed === 'object' && parsed.blocks && parsed.edges) {
                const serializer = new Serializer()
                const serialized = serializer.serializeWorkflow(
                  parsed.blocks,
                  parsed.edges,
                  parsed.loops || {},
                  parsed.parallels || {},
                  false
                )
                if (typeof serialized === 'string') yamlContent = serialized
              }
            } catch {}
          } else {
            yamlContent = serverData
          }
        }

        if (yamlContent) {
          await diffStore.setProposedChanges(yamlContent)
          logger.info('Diff store updated from get_user_workflow result', {
            yamlLength: yamlContent.length,
          })
        } else {
          logger.warn('No yamlContent found/derived in server result to trigger diff')
        }
      } catch (e) {
        logger.error('Failed to update diff store from get_user_workflow result', {
          error: e instanceof Error ? e.message : String(e),
        })
      }

      return result
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
