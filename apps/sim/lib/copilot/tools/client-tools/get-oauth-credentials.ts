/**
 * Get OAuth Credentials - Client-side wrapper that posts to methods route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class GetOAuthCredentialsClientTool extends BaseTool {
  static readonly id = 'get_oauth_credentials'

  metadata: ToolMetadata = {
    id: GetOAuthCredentialsClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Retrieving login IDs', icon: 'spinner' },
        success: { displayName: 'Retrieved login IDs', icon: 'key' },
        rejected: { displayName: 'Skipped retrieving login IDs', icon: 'skip' },
        errored: { displayName: 'Failed to retrieve login IDs', icon: 'error' },
        aborted: { displayName: 'Retrieving login IDs aborted', icon: 'abort' },
      },
    },
    schema: {
      name: GetOAuthCredentialsClientTool.id,
      description: 'Get OAuth credentials for the current user',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'Optional explicit userId override' },
        },
        required: [],
      },
    },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('GetOAuthCredentialsClientTool')

    try {
      options?.onStateChange?.('executing')

      const provided = (toolCall.parameters || toolCall.input || {}) as Record<string, any>
      const userId: string | undefined = provided.userId

      logger.info('Posting get_oauth_credentials to methods route', {
        toolCallId: toolCall.id,
        methodId: 'get_oauth_credentials',
        hasUserId: !!userId,
      })

      const response = await fetch('/api/copilot/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          methodId: 'get_oauth_credentials',
          params: { ...(userId ? { userId } : {}) },
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
        return { success: false, error: errorData?.error || 'Failed to execute server method' }
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
      return { success: true, data: result.data }
    } catch (error: any) {
      logger.error('Error in client tool execution:', {
        toolCallId: toolCall.id,
        error: error,
        message: error instanceof Error ? error.message : String(error),
      })
      options?.onStateChange?.('errored')
      return { success: false, error: error.message || 'Failed to retrieve login IDs' }
    }
  }
}
