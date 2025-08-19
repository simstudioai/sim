/**
 * Get Blocks Metadata - Client-side wrapper that posts to methods route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class GetBlocksMetadataClientTool extends BaseTool {
  static readonly id = 'get_blocks_metadata'

  metadata: ToolMetadata = {
    id: GetBlocksMetadataClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Evaluating workflow options', icon: 'spinner' },
        success: { displayName: 'Evaluated workflow options', icon: 'betweenHorizontalEnd' },
        rejected: { displayName: 'Skipped evaluating workflow options', icon: 'skip' },
        errored: { displayName: 'Failed to evaluate workflow options', icon: 'error' },
        aborted: { displayName: 'Options evaluation aborted', icon: 'abort' },
      },
    },
    schema: {
      name: GetBlocksMetadataClientTool.id,
      description: 'Get metadata for specified blocks',
      parameters: {
        type: 'object',
        properties: {
          blockIds: { type: 'array', items: { type: 'string' }, description: 'Block IDs' },
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
    const logger = createLogger('GetBlocksMetadataClientTool')

    // Safe stringify helper
    const safeStringify = (obj: any, maxLength: number = 500): string => {
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

      // Log the entire tool call object first
      logger.info('FULL TOOL CALL OBJECT:', {
        toolCallStringified: safeStringify(toolCall, 2000),
        toolCallKeys: Object.keys(toolCall),
        toolCallId: toolCall.id,
        toolCallName: (toolCall as any).name,
      })

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
        logger.info('Raw tool call received:', {
          toolCallId: toolCall.id,
          hasParameters: !!toolCall.parameters,
          hasInput: !!toolCall.input,
          hasArguments: !!extendedToolCall.arguments,
          parametersType: typeof toolCall.parameters,
          inputType: typeof toolCall.input,
          argumentsType: typeof extendedToolCall.arguments,
          parametersKeys: toolCall.parameters && typeof toolCall.parameters === 'object' 
            ? Object.keys(toolCall.parameters) 
            : [],
          rawParameters: safeStringify(toolCall.parameters),
          rawInput: safeStringify(toolCall.input),
          rawArguments: safeStringify(extendedToolCall.arguments),
        })
      } catch (logError) {
        logger.error('Error logging raw tool call:', logError)
      }

      // Handle different possible sources of parameters
      // Priority: parameters > input > arguments (all should be the same now)
      const provided = toolCall.parameters || toolCall.input || extendedToolCall.arguments || {}

      logger.info('Parameter sources:', {
        hasArguments: !!extendedToolCall.arguments,
        hasParameters: !!toolCall.parameters,
        hasInput: !!toolCall.input,
        providedSource: extendedToolCall.arguments ? 'arguments' : toolCall.parameters ? 'parameters' : toolCall.input ? 'input' : 'none',
        providedKeys: Object.keys(provided),
        providedStringified: safeStringify(provided),
      })

      // If provided directly has blockIds and it's an array, use it
      let blockIds: string[] | undefined
      
      if (provided.blockIds && Array.isArray(provided.blockIds)) {
        // Direct case: arguments.blockIds is already an array
        blockIds = provided.blockIds.map((v: any) => String(v))
        logger.info('Found blockIds directly in provided.blockIds', {
          count: blockIds!.length,
          values: blockIds,
        })
      } else {
        logger.info('blockIds not found directly, trying alternative extraction', {
          hasBlockIds: !!provided.blockIds,
          blockIdsType: provided.blockIds ? typeof provided.blockIds : 'undefined',
          blockIdsValue: safeStringify(provided.blockIds),
        })
        
        // Handle the case where parameters might be nested or in different formats
        const args = provided.arguments || provided
        
        logger.info('Checking alternative sources', {
          argsKeys: Object.keys(args),
          argsStringified: safeStringify(args),
        })
        
        // Accept several common shapes/keys
        const candidate =
          args.blockIds ??
          args.block_ids ??
          args.ids ??
          args.blocks ??
          args.blockTypes ??
          args.block_types ??
          provided.blockIds ??
          provided.block_ids ??
          provided.ids ??
          provided.blocks ??
          provided.blockTypes ??
          provided.block_types

        const raw = candidate

        logger.info('Candidate extraction result', {
          hasCandidate: !!raw,
          candidateType: raw === undefined ? 'undefined' : Array.isArray(raw) ? 'array' : typeof raw,
          candidateValue: safeStringify(raw),
        })

        // Robust parsing of blockIds
        // First, check if it's already an array
        if (Array.isArray(raw)) {
          blockIds = raw.map((v) => String(v))
          logger.info('Parsed array candidate', {
            count: blockIds.length,
            values: blockIds,
          })
        } 
        // Handle string that might be JSON array
        else if (typeof raw === 'string') {
          // Try to parse as JSON first
          try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
              blockIds = parsed.map((v) => String(v))
            } else {
              // Fall back to comma-separated
              blockIds = raw
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
            }
          } catch {
            // Not JSON, treat as comma-separated
            blockIds = raw
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          }
        } 
        // Handle object shapes
        else if (raw && typeof raw === 'object') {
          // Handle shapes like {0:'agent',1:'api'} or {items:['agent','api']}
          const fromItems = Array.isArray((raw as any).items) ? (raw as any).items : null
          const values = fromItems || Object.values(raw)
          if (Array.isArray(values) && values.length > 0) {
            const cleaned = values
              .map((v: any) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null))
              .filter((v: any): v is string => typeof v === 'string' && v.length > 0)
            if (cleaned.length > 0) blockIds = cleaned
          }
        }

        // If we still don't have blockIds, check if the entire provided object might be the array
        if (!blockIds && Array.isArray(provided)) {
          blockIds = provided.map((v) => String(v))
        }
      }

      logger.info('Parsed tool call for get_blocks_metadata', {
        toolCallId: toolCall.id,
        hasBlockIds: !!blockIds,
        parsedIsArray: Array.isArray(blockIds),
        parsedCount: Array.isArray(blockIds) ? blockIds.length : 0,
        parsedValues: Array.isArray(blockIds) ? blockIds : undefined,
      })

      logger.info('Posting get_blocks_metadata to methods route', {
        toolCallId: toolCall.id,
        methodId: 'get_blocks_metadata',
        hasBlockIds: Array.isArray(blockIds) && blockIds.length > 0,
        blockIdsCount: Array.isArray(blockIds) ? blockIds.length : 0,
        blockIdsToSend: blockIds,
      })

      // Ensure we send a valid structure with blockIds as an array
      const paramsToSend = {
        blockIds: Array.isArray(blockIds) ? blockIds : []
      }

      logger.info('Final params for get_blocks_metadata', {
        params: paramsToSend,
        blockIdsType: Array.isArray(paramsToSend.blockIds) ? 'array' : typeof paramsToSend.blockIds,
        blockIdsCount: paramsToSend.blockIds.length,
        blockIdsValue: paramsToSend.blockIds,
      })

      const requestBody = {
        methodId: 'get_blocks_metadata',
        params: paramsToSend,
        toolCallId: toolCall.id,
        toolId: toolCall.id,
      }

      logger.info('Sending request to methods route', {
        url: '/api/copilot/methods',
        body: safeStringify(requestBody, 1000),
      })

      const response = await fetch('/api/copilot/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
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
      return { success: false, error: error.message || 'Failed to get blocks metadata' }
    }
  }
} 