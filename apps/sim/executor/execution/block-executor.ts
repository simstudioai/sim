import { createLogger } from '@/lib/logs/console/logger'
import { isSentinelBlockType } from '@/executor/consts'
import type {
  BlockHandler,
  BlockLog,
  ExecutionContext,
  NormalizedBlockOutput,
} from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import type { DAGNode } from '../dag/builder'
import type { VariableResolver } from '../variables/resolver'
import type { ContextExtensions } from './types'

const logger = createLogger('BlockExecutor')

const FALLBACK_VALUE = {
  BLOCK_TYPE: 'unknown',
} as const

export class BlockExecutor {
  constructor(
    private blockHandlers: BlockHandler[],
    private resolver: VariableResolver,
    private contextExtensions: ContextExtensions
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

    const resolvedInputs = this.resolver.resolveInputs(block.config.params, node.id, context, block)

    // Check if this is a sentinel node (virtual node that shouldn't appear in logs)
    const isSentinel = isSentinelBlockType(block.metadata?.id ?? '')

    // Only create logs and callbacks for non-sentinel nodes
    let blockLog: BlockLog | undefined
    if (!isSentinel) {
      blockLog = this.createBlockLog(node.id, block)
      context.blockLogs.push(blockLog)
      this.callOnBlockStart(node.id, block)
    }

    const startTime = Date.now()

    try {
      const output = await handler.execute(block, resolvedInputs, context)
      const normalizedOutput = this.normalizeOutput(output)

      const duration = Date.now() - startTime

      if (blockLog) {
        blockLog.endedAt = new Date().toISOString()
        blockLog.durationMs = duration
        blockLog.success = true
        blockLog.output = normalizedOutput
      }

      context.blockStates.set(node.id, {
        output: normalizedOutput,
        executed: true,
        executionTime: duration,
      })

      if (!isSentinel) {
        this.callOnBlockComplete(node.id, block, normalizedOutput, duration)
      }

      return normalizedOutput
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (blockLog) {
        blockLog.endedAt = new Date().toISOString()
        blockLog.durationMs = duration
        blockLog.success = false
        blockLog.error = errorMessage
      }

      const errorOutput: NormalizedBlockOutput = {
        error: errorMessage,
      }

      context.blockStates.set(node.id, {
        output: errorOutput,
        executed: true,
        executionTime: duration,
      })

      logger.error('Block execution failed', {
        blockId: node.id,
        blockType: block.metadata?.id,
        error: errorMessage,
      })

      if (!isSentinel && this.contextExtensions.onBlockComplete) {
        await this.contextExtensions.onBlockComplete(
          node.id,
          block.metadata?.name || node.id,
          block.metadata?.id || FALLBACK_VALUE.BLOCK_TYPE,
          {
            output: errorOutput,
            executionTime: duration,
          }
        )
      }

      throw error
    }
  }

  private findHandler(block: SerializedBlock): BlockHandler | undefined {
    return this.blockHandlers.find((h) => h.canHandle(block))
  }

  private createBlockLog(blockId: string, block: SerializedBlock): BlockLog {
    return {
      blockId,
      blockName: block.metadata?.name || blockId,
      blockType: block.metadata?.id || FALLBACK_VALUE.BLOCK_TYPE,
      startedAt: new Date().toISOString(),
      endedAt: '',
      durationMs: 0,
      success: false,
    }
  }

  private normalizeOutput(output: unknown): NormalizedBlockOutput {
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
    const blockType = block.metadata?.id || FALLBACK_VALUE.BLOCK_TYPE

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
    const blockType = block.metadata?.id || FALLBACK_VALUE.BLOCK_TYPE

    if (this.contextExtensions.onBlockComplete) {
      this.contextExtensions.onBlockComplete(blockId, blockName, blockType, {
        output,
        executionTime: duration,
      })
    }
  }
}
