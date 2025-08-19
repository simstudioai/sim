/**
 * Read Google Drive File - Client-side wrapper that posts to methods route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type { CopilotToolCall, ToolExecuteResult, ToolExecutionOptions, ToolMetadata } from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class ReadGDriveFileClientTool extends BaseTool {
  static readonly id = 'read_gdrive_file'

  metadata: ToolMetadata = {
    id: ReadGDriveFileClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Reading Google Drive file', icon: 'spinner' },
        success: { displayName: 'Read Google Drive file', icon: 'file' },
        rejected: { displayName: 'Skipped reading file', icon: 'skip' },
        errored: { displayName: 'Failed to read file', icon: 'error' },
        aborted: { displayName: 'Aborted reading file', icon: 'abort' },
      },
    },
    schema: {
      name: ReadGDriveFileClientTool.id,
      description: 'Read contents from a Google Drive doc or sheet',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          fileId: { type: 'string' },
          type: { type: 'string', enum: ['doc', 'sheet'] },
          range: { type: 'string' },
        },
        required: ['userId', 'fileId', 'type'],
      },
    },
    requiresInterrupt: false,
  }

  async execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
    const logger = createLogger('ReadGDriveFileClientTool')
    const safeStringify = (o: any, m: number = 800) => { try { if (o===undefined) return 'undefined'; if (o===null) return 'null'; return JSON.stringify(o).substring(0,m) } catch { return '[unserializable]' } }

    try {
      options?.onStateChange?.('executing')
      const ext = toolCall as CopilotToolCall & { arguments?: any }
      if (ext.arguments && !toolCall.parameters && !toolCall.input) { toolCall.input = ext.arguments; toolCall.parameters = ext.arguments }
      const provided = toolCall.parameters || toolCall.input || ext.arguments || {}

      const userId = provided.userId || provided.user_id || ''
      const fileId = provided.fileId || provided.file_id || ''
      const type = provided.type || provided.kind || ''
      const range = provided.range

      if (!userId || !fileId || !type) {
        options?.onStateChange?.('errored')
        return { success: false, error: 'userId, fileId and type are required' }
      }

      const paramsToSend: any = { userId, fileId, type }
      if (typeof range === 'string' && range.trim()) paramsToSend.range = range.trim()

      const body = { methodId: 'read_gdrive_file', params: paramsToSend, toolCallId: toolCall.id, toolId: toolCall.id }
      logger.info('Sending request', { body: safeStringify(body, 1200) })

      const response = await fetch('/api/copilot/methods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      if (!response.ok) { const e = await response.json().catch(()=>({})); options?.onStateChange?.('errored'); return { success:false, error: e?.error || 'Failed to read file' } }

      const result = await response.json()
      if (!result.success) { options?.onStateChange?.('errored'); return { success:false, error: result.error || 'Server method failed' } }

      options?.onStateChange?.('success')
      return { success:true, data: result.data }
    } catch (error:any) {
      options?.onStateChange?.('errored')
      return { success:false, error: error?.message || 'Unexpected error' }
    }
  }
} 