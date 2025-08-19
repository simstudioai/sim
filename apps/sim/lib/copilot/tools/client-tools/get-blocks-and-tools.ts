/**
 * Get Blocks and Tools - Client-side wrapper that posts to methods route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class GetBlocksAndToolsClientTool extends BaseTool {
  static readonly id = 'get_blocks_and_tools'

  metadata: ToolMetadata = {
    id: GetBlocksAndToolsClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Getting block information', icon: 'spinner' },
        success: { displayName: 'Retrieved block information', icon: 'blocks' },
        rejected: { displayName: 'Skipped getting block information', icon: 'skip' },
        errored: { displayName: 'Failed to get block information', icon: 'error' },
        aborted: { displayName: 'Aborted getting block information', icon: 'abort' },
      },
    },
    schema: {
      name: GetBlocksAndToolsClientTool.id,
      description: 'List available blocks and their tools',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('GetBlocksAndToolsClientTool')

    try {
      options?.onStateChange?.('executing')
      logger.info('Posting get_blocks_and_tools to methods route', {
        toolCallId: toolCall.id,
        methodId: 'get_blocks_and_tools',
      })

      const response = await fetch('/api/copilot/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          methodId: 'get_blocks_and_tools',
          params: {},
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
        return { success: false, error: result.error || 'Server method execution failed' }
      }

      options?.onStateChange?.('success')
      return {
        success: true,
        data: result.data,
      }
    } catch (error: any) {
      logger.error('Error in client tool execution:', {
        toolCallId: toolCall.id,
        error: error,
        message: error instanceof Error ? error.message : String(error),
      })
      options?.onStateChange?.('errored')
      return { success: false, error: error.message || 'Failed to get block information' }
    }
  }
} 