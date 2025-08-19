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
import { buildUserWorkflowJson } from '@/lib/copilot/tools/client-tools/workflow-helpers'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'

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

    logger.info('Starting client tool execution', { toolCallId: toolCall.id })

    try {
      // Parse parameters
      const rawParams = toolCall.parameters || toolCall.input || {}
      const params = rawParams as GetUserWorkflowParams

      // Build workflow JSON using shared helper
      const workflowJson = buildUserWorkflowJson(params.workflowId)

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
