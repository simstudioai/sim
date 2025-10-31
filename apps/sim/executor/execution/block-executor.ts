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
import type { ExecutionState } from './state'
import type { ContextExtensions } from './types'
import type { SubflowType } from '@/stores/workflows/workflow/types'

const logger = createLogger('BlockExecutor')
const FALLBACK_VALUE = {
  BLOCK_TYPE: 'unknown',
} as const

export class BlockExecutor {
  constructor(
    private blockHandlers: BlockHandler[],
    private resolver: VariableResolver,
    private contextExtensions: ContextExtensions,
    private state?: ExecutionState
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
    const isSentinel = isSentinelBlockType(block.metadata?.id ?? '')

    let blockLog: BlockLog | undefined
    if (!isSentinel) {
      blockLog = this.createBlockLog(node.id, block, node, context)
      context.blockLogs.push(blockLog)
      this.callOnBlockStart(node.id, block, node, context)
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
        this.callOnBlockComplete(node.id, block, node, normalizedOutput, duration, context)
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

      if (!isSentinel) {
        this.callOnBlockComplete(node.id, block, node, errorOutput, duration, context)
      }

      throw error
    }
  }

  private findHandler(block: SerializedBlock): BlockHandler | undefined {
    return this.blockHandlers.find((h) => h.canHandle(block))
  }

  private createBlockLog(
    blockId: string,
    block: SerializedBlock,
    node?: DAGNode,
    context?: ExecutionContext
  ): BlockLog {
    let blockName = block.metadata?.name || blockId
    let loopId: string | undefined
    let parallelId: string | undefined
    let iterationIndex: number | undefined
    
    if (node?.metadata) {
      if (node.metadata.branchIndex !== undefined && node.metadata.parallelId) {
        blockName = `${blockName} (iteration ${node.metadata.branchIndex})`
        iterationIndex = node.metadata.branchIndex
        parallelId = node.metadata.parallelId
        logger.debug('Added parallel iteration suffix', { 
          blockId, 
          parallelId,
          branchIndex: node.metadata.branchIndex, 
          blockName 
        })
      } else if (node.metadata.isLoopNode && node.metadata.loopId && this.state) {
        loopId = node.metadata.loopId
        const loopScope = this.state.getLoopScope(loopId)
        if (loopScope && loopScope.iteration !== undefined) {
          blockName = `${blockName} (iteration ${loopScope.iteration})`
          iterationIndex = loopScope.iteration
          logger.debug('Added loop iteration suffix', { 
            blockId, 
            loopId, 
            iteration: loopScope.iteration, 
            blockName 
          })
        } else {
          logger.warn('Loop scope not found for block', { blockId, loopId })
        }
      }
    }
    
    return {
      blockId,
      blockName,
      blockType: block.metadata?.id || FALLBACK_VALUE.BLOCK_TYPE,
      startedAt: new Date().toISOString(),
      endedAt: '',
      durationMs: 0,
      success: false,
      loopId,
      parallelId,
      iterationIndex,
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

  private callOnBlockStart(blockId: string, block: SerializedBlock, node: DAGNode, context: ExecutionContext): void {
    const blockName = block.metadata?.name || blockId
    const blockType = block.metadata?.id || FALLBACK_VALUE.BLOCK_TYPE

    // Calculate iteration context for console pills
    const iterationContext = this.getIterationContext(node)

    if (this.contextExtensions.onBlockStart) {
      this.contextExtensions.onBlockStart(blockId, blockName, blockType, iterationContext)
    }
  }

  private callOnBlockComplete(
    blockId: string,
    block: SerializedBlock,
    node: DAGNode,
    output: NormalizedBlockOutput,
    duration: number,
    context: ExecutionContext
  ): void {

    const blockName = block.metadata?.name || blockId
    const blockType = block.metadata?.id || FALLBACK_VALUE.BLOCK_TYPE

    // Calculate iteration context for console pills
    const iterationContext = this.getIterationContext(node)

    if (this.contextExtensions.onBlockComplete) {
      this.contextExtensions.onBlockComplete(blockId, blockName, blockType, {
        output,
        executionTime: duration,
      }, iterationContext)
    }
  }

  private getIterationContext(node: DAGNode): { iterationCurrent: number; iterationTotal: number; iterationType: SubflowType } | undefined {
    if (!node?.metadata) return undefined

    // For parallel branches
    if (node.metadata.branchIndex !== undefined && node.metadata.branchTotal) {
      return {
        iterationCurrent: node.metadata.branchIndex,
        iterationTotal: node.metadata.branchTotal,
        iterationType: 'parallel',
      }
    }

    // For loop iterations
    if (node.metadata.isLoopNode && node.metadata.loopId && this.state) {
      const loopScope = this.state.getLoopScope(node.metadata.loopId)
      if (loopScope && loopScope.iteration !== undefined && loopScope.maxIterations) {
        return {
          iterationCurrent: loopScope.iteration,
          iterationTotal: loopScope.maxIterations,
          iterationType: 'loop',
        }
      }
    }

    return undefined
  }
}
