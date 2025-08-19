/**
 * Make API Request - Client-side wrapper that posts to methods route (requires interrupt)
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type { CopilotToolCall, ToolExecuteResult, ToolExecutionOptions, ToolMetadata } from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'
import { getProvidedParams, normalizeToolCallArguments, postToMethods } from '@/lib/copilot/tools/client-tools/client-utils'

export class MakeApiRequestClientTool extends BaseTool {
  static readonly id = 'make_api_request'

  metadata: ToolMetadata = {
    id: MakeApiRequestClientTool.id,
    displayConfig: {
      states: {
        pending: { displayName: 'Make API request?', icon: 'edit' },
        executing: { displayName: 'Making API request', icon: 'spinner' },
        success: { displayName: 'Made API request', icon: 'globe' },
        rejected: { displayName: 'Skipped API request', icon: 'skip' },
        errored: { displayName: 'Failed to make API request', icon: 'error' },
        aborted: { displayName: 'Aborted API request', icon: 'abort' },
      },
    },
    schema: {
      name: MakeApiRequestClientTool.id,
      description: 'Make an HTTP API request',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT'] },
          queryParams: { type: 'object' },
          headers: { type: 'object' },
          body: { type: 'object' },
        },
        required: ['url', 'method'],
      },
    },
    requiresInterrupt: true,
  }

  async execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
    const logger = createLogger('MakeApiRequestClientTool')

    try {
      normalizeToolCallArguments(toolCall)
      const provided = getProvidedParams(toolCall)

      const url = provided.url
      const method = provided.method
      const queryParams = provided.queryParams
      const headers = provided.headers
      const body = provided.body

      if (!url || !method) {
        options?.onStateChange?.('errored')
        return { success: false, error: 'url and method are required' }
      }

      const paramsToSend = {
        url,
        method,
        ...(queryParams ? { queryParams } : {}),
        ...(headers ? { headers } : {}),
        ...(body ? { body } : {}),
      }

      return await postToMethods('make_api_request', paramsToSend, { toolCallId: toolCall.id, toolId: toolCall.id }, options)
    } catch (error: any) {
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
} 