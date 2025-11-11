import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import {
  BlockType,
  buildResumeApiUrl,
  buildResumeUiUrl,
  DEFAULTS,
  EDGE,
  isSentinelBlockType,
} from '@/executor/consts'
import type { DAGNode } from '@/executor/dag/builder'
import type { BlockStateWriter, ContextExtensions } from '@/executor/execution/types'
import {
  generatePauseContextId,
  mapNodeMetadataToPauseScopes,
} from '@/executor/human-in-the-loop/utils.ts'
import type {
  BlockHandler,
  BlockLog,
  BlockState,
  ExecutionContext,
  NormalizedBlockOutput,
} from '@/executor/types'
import { buildBlockExecutionError, normalizeError } from '@/executor/utils/errors'
import type { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedBlock } from '@/serializer/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'

const logger = createLogger('BlockExecutor')

export class BlockExecutor {
  constructor(
    private blockHandlers: BlockHandler[],
    private resolver: VariableResolver,
    private contextExtensions: ContextExtensions,
    private state: BlockStateWriter
  ) {}

  async execute(
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock
  ): Promise<NormalizedBlockOutput> {
    const handler = this.findHandler(block)
    if (!handler) {
      throw buildBlockExecutionError({
        block,
        context: ctx,
        error: `No handler found for block type: ${block.metadata?.id ?? 'unknown'}`,
      })
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

    const nodeMetadata = this.buildNodeMetadata(node)
    let cleanupSelfReference: (() => void) | undefined

    if (block.metadata?.id === BlockType.HUMAN_IN_THE_LOOP) {
      cleanupSelfReference = this.preparePauseResumeSelfReference(ctx, node, block, nodeMetadata)
    }

    try {
      resolvedInputs = this.resolver.resolveInputs(ctx, node.id, block.config.params, block)
    } catch (error) {
      cleanupSelfReference?.()
      return this.handleBlockError(
        error,
        ctx,
        node,
        block,
        startTime,
        blockLog,
        resolvedInputs,
        isSentinel,
        'input_resolution'
      )
    }
    cleanupSelfReference?.()

    try {
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
          streamingExec.execution.output ?? streamingExec.execution
        )
      } else {
        normalizedOutput = this.normalizeOutput(output)
      }

      const duration = Date.now() - startTime

      if (blockLog) {
        blockLog.endedAt = new Date().toISOString()
        blockLog.durationMs = duration
        blockLog.success = true
        blockLog.output = this.filterOutputForLog(block, normalizedOutput)
      }

      this.state.setBlockOutput(node.id, normalizedOutput, duration)

      if (!isSentinel) {
        const filteredOutput = this.filterOutputForLog(block, normalizedOutput)
        this.callOnBlockComplete(ctx, node, block, resolvedInputs, filteredOutput, duration)
      }

      return normalizedOutput
    } catch (error) {
      return this.handleBlockError(
        error,
        ctx,
        node,
        block,
        startTime,
        blockLog,
        resolvedInputs,
        isSentinel,
        'execution'
      )
    }
  }

  private buildNodeMetadata(node: DAGNode): {
    nodeId: string
    loopId?: string
    parallelId?: string
    branchIndex?: number
    branchTotal?: number
  } {
    const metadata = node?.metadata ?? {}
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

  private handleBlockError(
    error: unknown,
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock,
    startTime: number,
    blockLog: BlockLog | undefined,
    resolvedInputs: Record<string, any>,
    isSentinel: boolean,
    phase: 'input_resolution' | 'execution'
  ): NormalizedBlockOutput {
    const duration = Date.now() - startTime
    const errorMessage = normalizeError(error)

    if (blockLog) {
      blockLog.endedAt = new Date().toISOString()
      blockLog.durationMs = duration
      blockLog.success = false
      blockLog.error = errorMessage
    }

    const errorOutput: NormalizedBlockOutput = {
      error: errorMessage,
    }

    this.state.setBlockOutput(node.id, errorOutput, duration)

    logger.error(
      phase === 'input_resolution' ? 'Failed to resolve block inputs' : 'Block execution failed',
      {
        blockId: node.id,
        blockType: block.metadata?.id,
        error: errorMessage,
      }
    )

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

    const errorToThrow = error instanceof Error ? error : new Error(errorMessage)

    throw buildBlockExecutionError({
      block,
      error: errorToThrow,
      context: ctx,
      additionalInfo: {
        nodeId: node.id,
        executionTime: duration,
      },
    })
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
    let blockName = block.metadata?.name ?? blockId
    let loopId: string | undefined
    let parallelId: string | undefined
    let iterationIndex: number | undefined

    if (node?.metadata) {
      if (node.metadata.branchIndex !== undefined && node.metadata.parallelId) {
        blockName = `${blockName} (iteration ${node.metadata.branchIndex})`
        iterationIndex = node.metadata.branchIndex
        parallelId = node.metadata.parallelId
      } else if (node.metadata.isLoopNode && node.metadata.loopId) {
        loopId = node.metadata.loopId
        const loopScope = ctx.loopExecutions?.get(loopId)
        if (loopScope && loopScope.iteration !== undefined) {
          blockName = `${blockName} (iteration ${loopScope.iteration})`
          iterationIndex = loopScope.iteration
        } else {
          logger.warn('Loop scope not found for block', { blockId, loopId })
        }
      }
    }

    return {
      blockId,
      blockName,
      blockType: block.metadata?.id ?? DEFAULTS.BLOCK_TYPE,
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

  private filterOutputForLog(
    block: SerializedBlock,
    output: NormalizedBlockOutput
  ): NormalizedBlockOutput {
    if (block.metadata?.id === BlockType.HUMAN_IN_THE_LOOP) {
      const filtered: NormalizedBlockOutput = {}
      for (const [key, value] of Object.entries(output)) {
        if (key.startsWith('_')) continue
        if (key === 'response') continue
        filtered[key] = value
      }
      return filtered
    }
    return output
  }

  private callOnBlockStart(ctx: ExecutionContext, node: DAGNode, block: SerializedBlock): void {
    const blockId = node.id
    const blockName = block.metadata?.name ?? blockId
    const blockType = block.metadata?.id ?? DEFAULTS.BLOCK_TYPE

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
    const blockName = block.metadata?.name ?? blockId
    const blockType = block.metadata?.id ?? DEFAULTS.BLOCK_TYPE

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

  private preparePauseResumeSelfReference(
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock,
    nodeMetadata: {
      nodeId: string
      loopId?: string
      parallelId?: string
      branchIndex?: number
      branchTotal?: number
    }
  ): (() => void) | undefined {
    const blockId = node.id

    const existingState = ctx.blockStates.get(blockId)
    if (existingState?.executed) {
      return undefined
    }

    const executionId = ctx.executionId ?? ctx.metadata?.executionId
    const workflowId = ctx.workflowId

    if (!executionId || !workflowId) {
      return undefined
    }

    const { loopScope } = mapNodeMetadataToPauseScopes(ctx, nodeMetadata)
    const contextId = generatePauseContextId(block.id, nodeMetadata, loopScope)

    let resumeLinks: { apiUrl: string; uiUrl: string }

    try {
      const baseUrl = getBaseUrl()
      resumeLinks = {
        apiUrl: buildResumeApiUrl(baseUrl, workflowId, executionId, contextId),
        uiUrl: buildResumeUiUrl(baseUrl, workflowId, executionId),
      }
    } catch {
      resumeLinks = {
        apiUrl: buildResumeApiUrl(undefined, workflowId, executionId, contextId),
        uiUrl: buildResumeUiUrl(undefined, workflowId, executionId),
      }
    }

    let previousState: BlockState | undefined
    if (existingState) {
      previousState = { ...existingState }
    }
    const hadPrevious = existingState !== undefined

    const placeholderState: BlockState = {
      output: {
        url: resumeLinks.uiUrl,
        // apiUrl: resumeLinks.apiUrl, // Hidden from output
      },
      executed: false,
      executionTime: existingState?.executionTime ?? 0,
    }

    this.state.setBlockState(blockId, placeholderState)

    return () => {
      if (hadPrevious && previousState) {
        this.state.setBlockState(blockId, previousState)
      } else {
        this.state.deleteBlockState(blockId)
      }
    }
  }
}
