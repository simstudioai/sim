/**
 * List Google Drive Files - Client-side wrapper that posts to methods route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type { CopilotToolCall, ToolExecuteResult, ToolExecutionOptions, ToolMetadata } from '@/lib/copilot/tools/types'
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

  async execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
    const logger = createLogger('ListGDriveFilesClientTool')

    const safeStringify = (obj: any, max: number = 800) => {
      try { if (obj === undefined) return 'undefined'; if (obj === null) return 'null'; const s = JSON.stringify(obj); return s.substring(0, max) } catch { return '[unserializable]' }
    }

    try {
      options?.onStateChange?.('executing')

      const ext = toolCall as CopilotToolCall & { arguments?: any }
      if (ext.arguments && !toolCall.parameters && !toolCall.input) {
        toolCall.input = ext.arguments
        toolCall.parameters = ext.arguments
        logger.info('Mapped arguments to input/parameters', { args: safeStringify(ext.arguments) })
      }

      const provided = toolCall.parameters || toolCall.input || ext.arguments || {}
      logger.info('Provided params', { toolCallId: toolCall.id, provided: safeStringify(provided) })

      const userId = provided.userId || provided.user_id || provided.user || ''
      const search_query = provided.search_query ?? provided.searchQuery ?? provided.query ?? undefined
      const num_results = provided.num_results ?? provided.limit ?? undefined

      // Do NOT require userId on client; server will inject from session if available
      const paramsToSend: any = {}
      if (typeof userId === 'string' && userId.trim()) paramsToSend.userId = userId.trim()
      if (typeof search_query === 'string' && search_query.trim()) paramsToSend.search_query = search_query.trim()
      if (typeof num_results === 'number') paramsToSend.num_results = num_results

      const body = { methodId: 'list_gdrive_files', params: paramsToSend, toolCallId: toolCall.id, toolId: toolCall.id }
      logger.info('Sending request', { body: safeStringify(body, 1200) })

      const response = await fetch('/api/copilot/methods', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body),
      })

      logger.info('Methods route response', { ok: response.ok, status: response.status })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        options?.onStateChange?.('errored')
        return { success: false, error: errorData?.error || 'Failed to list Google Drive files' }
      }

      const result = await response.json()
      logger.info('Parsed JSON', { success: result?.success, hasData: !!result?.data })
      if (!result.success) {
        options?.onStateChange?.('errored')
        return { success: false, error: result.error || 'Server method failed' }
      }

      options?.onStateChange?.('success')
      return { success: true, data: result.data }
    } catch (error: any) {
      logger.error('Client tool error', { toolCallId: toolCall.id, message: error?.message })
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
} 