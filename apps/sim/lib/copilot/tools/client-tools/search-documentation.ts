/**
 * Search Documentation - Client-side wrapper that posts to methods route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class SearchDocumentationClientTool extends BaseTool {
  static readonly id = 'search_documentation'

  metadata: ToolMetadata = {
    id: SearchDocumentationClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Searching documentation', icon: 'spinner' },
        success: { displayName: 'Searched documentation', icon: 'file' },
        rejected: { displayName: 'Skipped documentation search', icon: 'skip' },
        errored: { displayName: 'Failed to search documentation', icon: 'error' },
        aborted: { displayName: 'Documentation search aborted', icon: 'x' },
      },
    },
    schema: {
      name: SearchDocumentationClientTool.id,
      description: 'Search through documentation',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          topK: { type: 'number', description: 'Number of results to return' },
          threshold: { type: 'number', description: 'Similarity threshold' },
        },
        required: ['query'],
      },
    },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('SearchDocumentationClientTool')

    // Safe stringify helper
    const safeStringify = (obj: any, maxLength = 500): string => {
      try {
        if (obj === undefined) return 'undefined'
        if (obj === null) return 'null'
        const str = JSON.stringify(obj)
        return str ? str.substring(0, maxLength) : 'empty'
      } catch (e) {
        return `[stringify error: ${e}]`
      }
    }

    try {
      options?.onStateChange?.('executing')

      // Extended tool call interface to handle streaming arguments
      const extendedToolCall = toolCall as CopilotToolCall & { arguments?: any }

      // The streaming API provides 'arguments', but CopilotToolCall expects 'input' or 'parameters'
      // Map arguments to input/parameters if they don't exist
      if (extendedToolCall.arguments && !toolCall.input && !toolCall.parameters) {
        toolCall.input = extendedToolCall.arguments
        toolCall.parameters = extendedToolCall.arguments
        logger.info('Mapped arguments to input/parameters', {
          arguments: safeStringify(extendedToolCall.arguments),
        })
      }

      // Log the raw tool call to understand what we're receiving
      try {
        logger.info('Received tool call', {
          toolCallId: toolCall.id,
          hasParameters: !!toolCall.parameters,
          hasInput: !!toolCall.input,
          hasArguments: !!extendedToolCall.arguments,
        })
      } catch (logError) {
        logger.error('Error logging raw tool call:', logError)
      }

      // Handle different possible sources of parameters
      // Priority: parameters > input > arguments (all should be the same now)
      const provided = toolCall.parameters || toolCall.input || extendedToolCall.arguments || {}

      logger.info('Parameter sources', {
        hasArguments: !!extendedToolCall.arguments,
        hasParameters: !!toolCall.parameters,
        hasInput: !!toolCall.input,
      })

      // Extract search parameters
      const query = provided.query || provided.search || provided.q || ''
      const topK = provided.topK || provided.top_k || provided.limit || 10
      const threshold = provided.threshold || provided.similarity_threshold || undefined

      logger.info('Extracted search parameters', {
        hasQuery: !!query,
        topK,
        hasThreshold: threshold !== undefined,
      })

      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        logger.error('No valid query provided', {
          query,
          queryType: typeof query,
          provided: safeStringify(provided),
        })
        options?.onStateChange?.('errored')
        return { success: false, error: 'Search query is required' }
      }

      const paramsToSend = {
        query: query.trim(),
        topK,
        ...(threshold !== undefined && { threshold }),
      }

      const requestBody = {
        methodId: 'search_documentation',
        params: paramsToSend,
        toolCallId: toolCall.id,
        toolId: toolCall.id,
      }

      logger.info('Sending request to methods route', { url: '/api/copilot/methods' })

      const response = await fetch('/api/copilot/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      })

      logger.info('Methods route response received', { status: response.status })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        logger.error('Methods route error', {
          status: response.status,
          error: errorData,
        })
        options?.onStateChange?.('errored')
        return { success: false, error: errorData?.error || 'Failed to search documentation' }
      }

      const result = await response.json()

      if (!result.success) {
        options?.onStateChange?.('errored')
        return { success: false, error: result.error || 'Documentation search failed' }
      }

      options?.onStateChange?.('success')
      return { success: true, data: result.data }
    } catch (error: any) {
      logger.error('Error in client tool execution:', {
        toolCallId: toolCall.id,
        error: error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      options?.onStateChange?.('errored')
      return { success: false, error: error.message || 'Failed to search documentation' }
    }
  }
}
