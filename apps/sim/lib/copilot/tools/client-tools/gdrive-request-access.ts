import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class GDriveRequestAccessTool extends BaseTool {
  static readonly id = 'gdrive_request_access'

  metadata: ToolMetadata = {
    id: GDriveRequestAccessTool.id,
    displayConfig: {
      states: {
        pending: {
          displayName: 'Select Google Drive files',
          icon: 'googleDrive',
        },
        executing: {
          displayName: 'Requesting Google Drive access',
          icon: 'spinner',
        },
        accepted: {
          displayName: 'Requesting Google Drive access',
          icon: 'spinner',
        },
        success: {
          displayName: 'Selected Google Drive files',
          icon: 'googleDrive',
        },
        rejected: {
          displayName: 'Skipped Google Drive access request',
          icon: 'skip',
        },
        errored: {
          displayName: 'Failed to request Google Drive access',
          icon: 'error',
        },
      },
    },
    schema: {
      name: GDriveRequestAccessTool.id,
      description: 'Prompt the user to grant Google Drive file access via the picker',
      parameters: {
        type: 'object',
        properties: {
          // Accepts arbitrary context but no required params
        },
        required: [],
      },
    },
    requiresInterrupt: true,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('GDriveRequestAccessTool')

    try {
      options?.onStateChange?.('executing')

      // Mirror pattern used by other client tools: call methods route
      const body = {
        methodId: 'gdrive_request_access',
        params: {},
        toolCallId: toolCall.id,
        toolId: toolCall.id,
      }
      logger.info('Sending request access method call', { toolCallId: toolCall.id })

      const response = await fetch('/api/copilot/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        options?.onStateChange?.('errored')
        return {
          success: false,
          error: errorData?.error || 'Failed to request Google Drive access',
        }
      }

      const result = await response.json()
      if (!result?.success) {
        options?.onStateChange?.('errored')
        return { success: false, error: result?.error || 'Request access method failed' }
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
