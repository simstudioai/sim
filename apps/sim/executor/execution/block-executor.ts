import { createLogger } from '@/lib/logs/console/logger'
import { DEFAULTS, EDGE, isSentinelBlockType } from '@/executor/consts'
import type {
  BlockHandler,
  BlockLog,
  ExecutionContext,
  NormalizedBlockOutput,
} from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'
import type { DAGNode } from '../dag/builder'
import type { VariableResolver } from '../variables/resolver'
import type { ExecutionState } from './state'
import type { ContextExtensions } from './types'

const logger = createLogger('BlockExecutor')

export class BlockExecutor {
  constructor(
    private blockHandlers: BlockHandler[],
    private resolver: VariableResolver,
    private contextExtensions: ContextExtensions,
    private state?: ExecutionState
  ) {}

  async execute(
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock
  ): Promise<NormalizedBlockOutput> {
    const handler = this.findHandler(block)
    if (!handler) {
      throw new Error(`No handler found for block type: ${block.metadata?.id}`)
    }

    const isSentinel = isSentinelBlockType(block.metadata?.id ?? '')

    let blockLog: BlockLog | undefined
    if (!isSentinel) {
      blockLog = this.createBlockLog(ctx, node.id, block, node)
      ctx.blockLogs.push(blockLog)
      this.callOnBlockStart(ctx, node, block)
    }

    const startTime = Date.now()
    let resolvedInputs: Record<string, any> = {}

    try {
      resolvedInputs = this.resolver.resolveInputs(ctx, node.id, block.config.params, block)
      const nodeMetadata = this.buildNodeMetadata(node)
      const output = handler.executeWithNode
        ? await handler.executeWithNode(ctx, block, resolvedInputs, nodeMetadata)
        : await handler.execute(ctx, block, resolvedInputs)

      const isStreamingExecution =
        output && typeof output === 'object' && 'stream' in output && 'execution' in output

      let normalizedOutput: NormalizedBlockOutput
      if (isStreamingExecution) {
        const streamingExec = output as { stream: ReadableStream; execution: any }

        if (ctx.onStream) {
          try {
            await ctx.onStream(streamingExec)
          } catch (error) {
            logger.error('Error in onStream callback', { blockId: node.id, error })
          }
        }

        normalizedOutput = this.normalizeOutput(
          streamingExec.execution.output || streamingExec.execution
        )
      } else {
        normalizedOutput = this.normalizeOutput(output)
      }

      const duration = Date.now() - startTime

      if (blockLog) {
        blockLog.endedAt = new Date().toISOString()
        blockLog.durationMs = duration
        blockLog.success = true
        blockLog.output = normalizedOutput
      }

      ctx.blockStates.set(node.id, {
        output: normalizedOutput,
        executed: true,
        executionTime: duration,
      })

      if (!isSentinel) {
        this.callOnBlockComplete(ctx, node, block, resolvedInputs, normalizedOutput, duration)
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

      ctx.blockStates.set(node.id, {
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
        this.callOnBlockComplete(ctx, node, block, resolvedInputs, errorOutput, duration)
      }

      const hasErrorPort = this.hasErrorPortEdge(node)

      if (hasErrorPort) {
        logger.info('Block has error port - returning error output instead of throwing', {
          blockId: node.id,
          error: errorMessage,
        })
        return errorOutput
      }

      throw error
    }
  }

  private buildNodeMetadata(node: DAGNode): {
    nodeId: string
    loopId?: string
    parallelId?: string
    branchIndex?: number
    branchTotal?: number
  } {
    const metadata = node?.metadata || {}
    return {
      nodeId: node.id,
      loopId: metadata.loopId,
      parallelId: metadata.parallelId,
      branchIndex: metadata.branchIndex,
      branchTotal: metadata.branchTotal,
    }
  }

  private findHandler(block: SerializedBlock): BlockHandler | undefined {
    return this.blockHandlers.find((h) => h.canHandle(block))
  }

  private hasErrorPortEdge(node: DAGNode): boolean {
    for (const [_, edge] of node.outgoingEdges) {
      if (edge.sourceHandle === EDGE.ERROR) {
        return true
      }
    }
    return false
  }

  private createBlockLog(
    ctx: ExecutionContext,
    blockId: string,
    block: SerializedBlock,
    node: DAGNode
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
          blockName,
        })
      } else if (node.metadata.isLoopNode && node.metadata.loopId) {
        loopId = node.metadata.loopId
        const loopScope = ctx.loopExecutions?.get(loopId)
        if (loopScope && loopScope.iteration !== undefined) {
          blockName = `${blockName} (iteration ${loopScope.iteration})`
          iterationIndex = loopScope.iteration
          logger.debug('Added loop iteration suffix', {
            blockId,
            loopId,
            iteration: loopScope.iteration,
            blockName,
          })
        } else {
          logger.warn('Loop scope not found for block', { blockId, loopId })
        }
      }
    }

    return {
      blockId,
      blockName,
      blockType: block.metadata?.id || DEFAULTS.BLOCK_TYPE,
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

  private callOnBlockStart(ctx: ExecutionContext, node: DAGNode, block: SerializedBlock): void {
    const blockId = node.id
    const blockName = block.metadata?.name || blockId
    const blockType = block.metadata?.id || DEFAULTS.BLOCK_TYPE

    const iterationContext = this.getIterationContext(ctx, node)

    if (this.contextExtensions.onBlockStart) {
      this.contextExtensions.onBlockStart(blockId, blockName, blockType, iterationContext)
    }
  }

  private callOnBlockComplete(
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock,
    input: Record<string, any>,
    output: NormalizedBlockOutput,
    duration: number
  ): void {
    const blockId = node.id
    const blockName = block.metadata?.name || blockId
    const blockType = block.metadata?.id || DEFAULTS.BLOCK_TYPE

    const iterationContext = this.getIterationContext(ctx, node)

    if (this.contextExtensions.onBlockComplete) {
      this.contextExtensions.onBlockComplete(
        blockId,
        blockName,
        blockType,
        {
          input,
          output,
          executionTime: duration,
        },
        iterationContext
      )
    }
  }

  private getIterationContext(
    ctx: ExecutionContext,
    node: DAGNode
  ): { iterationCurrent: number; iterationTotal: number; iterationType: SubflowType } | undefined {
    if (!node?.metadata) return undefined

    if (node.metadata.branchIndex !== undefined && node.metadata.branchTotal) {
      return {
        iterationCurrent: node.metadata.branchIndex,
        iterationTotal: node.metadata.branchTotal,
        iterationType: 'parallel',
      }
    }

    if (node.metadata.isLoopNode && node.metadata.loopId) {
      const loopScope = ctx.loopExecutions?.get(node.metadata.loopId)
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
