/**
 * BlockExecutor
 * 
 * Executes individual blocks using their handlers.
 * Resolves inputs, executes, handles callbacks.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type {
  BlockHandler,
  BlockLog,
  ExecutionContext,
  NormalizedBlockOutput,
} from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import type { DAGNode } from './dag-builder'
import type { VariableResolver } from './variable-resolver'

const logger = createLogger('BlockExecutor')

export class BlockExecutor {
  constructor(
    private blockHandlers: BlockHandler[],
    private resolver: VariableResolver,
    private contextExtensions: any
  ) {}

  async execute(
    node: DAGNode,
    block: SerializedBlock,
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput> {
    const handler = this.findHandler(block)
    if (!handler) {
      throw new Error(`No handler found for block type: ${block.metadata?.id}`)
    }

    logger.info(`[BlockExecutor] Resolving inputs for block ${node.id}`, {
      blockType: block.metadata?.id,
      blockName: block.metadata?.name,
      rawParams: block.config.params,
    })

    const resolvedInputs = this.resolver.resolveInputs(block.config.params, node.id, context)

    logger.info(`[BlockExecutor] Resolved inputs for block ${node.id}`, {
      resolvedInputs,
    })

    const blockLog = this.createBlockLog(node.id, block)
    context.blockLogs.push(blockLog)

    this.callOnBlockStart(node.id, block)

    const startTime = Date.now()

    try {
      const output = await handler.execute(block, resolvedInputs, context)
      const normalizedOutput = this.normalizeOutput(output)

      const duration = Date.now() - startTime
      blockLog.endedAt = new Date().toISOString()
      blockLog.durationMs = duration
      blockLog.success = true
      blockLog.output = normalizedOutput

      this.callOnBlockComplete(node.id, block, normalizedOutput, duration)

      return normalizedOutput
    } catch (error) {
      const duration = Date.now() - startTime
      blockLog.endedAt = new Date().toISOString()
      blockLog.durationMs = duration
      blockLog.success = false
      blockLog.error = error instanceof Error ? error.message : String(error)

      logger.error('Block execution failed', {
        blockId: node.id,
        blockType: block.metadata?.id,
        error,
      })

      throw error
    }
  }

  private findHandler(block: SerializedBlock): BlockHandler | undefined {
    return this.blockHandlers.find(h => h.canHandle(block))
  }

  private createBlockLog(blockId: string, block: SerializedBlock): BlockLog {
    return {
      blockId,
      blockName: block.metadata?.name || blockId,
      blockType: block.metadata?.id || 'unknown',
      startedAt: new Date().toISOString(),
      endedAt: '',
      durationMs: 0,
      success: false,
    }
  }

  private normalizeOutput(output: any): NormalizedBlockOutput {
    if (output === null || output === undefined) {
      return {}
    }

    if (typeof output === 'object' && !Array.isArray(output)) {
      return output as NormalizedBlockOutput
    }

    return { result: output }
  }

  private callOnBlockStart(blockId: string, block: SerializedBlock): void {
    const blockName = block.metadata?.name || blockId
    const blockType = block.metadata?.id || 'unknown'

    if (this.contextExtensions.onBlockStart) {
      this.contextExtensions.onBlockStart(blockId, blockName, blockType)
    }
  }

  private callOnBlockComplete(
    blockId: string,
    block: SerializedBlock,
    output: NormalizedBlockOutput,
    duration: number
  ): void {
    const blockName = block.metadata?.name || blockId
    const blockType = block.metadata?.id || 'unknown'

    if (this.contextExtensions.onBlockComplete) {
      this.contextExtensions.onBlockComplete(blockId, blockName, blockType, {
        output,
        executionTime: duration,
      })
    }
  }
}

