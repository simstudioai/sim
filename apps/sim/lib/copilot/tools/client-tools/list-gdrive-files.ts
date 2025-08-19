/**
 * List Google Drive Files - Client-side wrapper that posts to methods route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import {
  getProvidedParams,
  normalizeToolCallArguments,
  postToMethods,
  safeStringify,
} from '@/lib/copilot/tools/client-tools/client-utils'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class ListGDriveFilesClientTool extends BaseTool {
  static readonly id = 'list_gdrive_files'

  metadata: ToolMetadata = {
    id: ListGDriveFilesClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Listing Google Drive files', icon: 'spinner' },
        success: { displayName: 'Listed Google Drive files', icon: 'file' },
        rejected: { displayName: 'Skipped listing Google Drive files', icon: 'skip' },
        errored: { displayName: 'Failed to list Google Drive files', icon: 'error' },
        aborted: { displayName: 'Aborted listing Google Drive files', icon: 'abort' },
      },
    },
    schema: {
      name: ListGDriveFilesClientTool.id,
      description: 'List files in Google Drive for a user',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID (for OAuth token lookup)' },
          search_query: { type: 'string', description: 'Search query' },
          searchQuery: { type: 'string', description: 'Search query (alias)' },
          num_results: { type: 'number', description: 'Max results' },
        },
        required: ['userId'],
      },
    },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('ListGDriveFilesClientTool')

    try {
      normalizeToolCallArguments(toolCall)
      const provided = getProvidedParams(toolCall)
      logger.info('Provided params', { toolCallId: toolCall.id, provided: safeStringify(provided) })

      const userId = provided.userId || provided.user_id || provided.user || ''
      const search_query =
        provided.search_query ?? provided.searchQuery ?? provided.query ?? undefined
      const num_results = provided.num_results ?? provided.limit ?? undefined

      const paramsToSend: any = {}
      if (typeof userId === 'string' && userId.trim()) paramsToSend.userId = userId.trim()
      if (typeof search_query === 'string' && search_query.trim())
        paramsToSend.search_query = search_query.trim()
      if (typeof num_results === 'number') paramsToSend.num_results = num_results

      return await postToMethods(
        'list_gdrive_files',
        paramsToSend,
        { toolCallId: toolCall.id, toolId: toolCall.id },
        options
      )
    } catch (error: any) {
      logger.error('Client tool error', { toolCallId: toolCall.id, message: error?.message })
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
}
