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
import { getProvidedParams, normalizeToolCallArguments, postToMethods, safeStringify } from '@/lib/copilot/tools/client-tools/client-utils'

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

    try {
      normalizeToolCallArguments(toolCall)

      const provided = getProvidedParams(toolCall) || {}

      let blockIds: string[] | undefined

      if (provided.blockIds && Array.isArray(provided.blockIds)) {
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

        const args = (provided as any).arguments || provided

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

        if (Array.isArray(raw)) {
          blockIds = raw.map((v) => String(v))
        } else if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
              blockIds = parsed.map((v) => String(v))
            } else {
              blockIds = raw
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
            }
          } catch {
            blockIds = raw
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          }
        } else if (raw && typeof raw === 'object') {
          const fromItems = Array.isArray((raw as any).items) ? (raw as any).items : null
          const values = fromItems || Object.values(raw as any)
          if (Array.isArray(values) && values.length > 0) {
            const cleaned = values
              .map((v: any) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null))
              .filter((v: any): v is string => typeof v === 'string' && v.length > 0)
            if (cleaned.length > 0) blockIds = cleaned
          }
        }

        if (!blockIds && Array.isArray(provided)) {
          blockIds = provided.map((v: any) => String(v))
        }
      }

      logger.info('Parsed tool call for get_blocks_metadata', {
        toolCallId: toolCall.id,
        hasBlockIds: !!blockIds,
        parsedIsArray: Array.isArray(blockIds),
        parsedCount: Array.isArray(blockIds) ? blockIds.length : 0,
        parsedValues: Array.isArray(blockIds) ? blockIds : undefined,
      })

      const paramsToSend = {
        blockIds: Array.isArray(blockIds) ? blockIds : [],
      }

      logger.info('Final params for get_blocks_metadata', {
        params: paramsToSend,
        blockIdsType: Array.isArray(paramsToSend.blockIds) ? 'array' : typeof paramsToSend.blockIds,
        blockIdsCount: paramsToSend.blockIds.length,
        blockIdsValue: paramsToSend.blockIds,
      })

      return await postToMethods('get_blocks_metadata', paramsToSend, { toolCallId: toolCall.id, toolId: toolCall.id }, options)
    } catch (error: any) {
      logger.error('Error in client tool execution:', {
        toolCallId: toolCall.id,
        error: error,
        message: error instanceof Error ? error.message : String(error),
      })
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Failed to get blocks metadata' }
    }
  }
} 