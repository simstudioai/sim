import { createLogger } from '@sim/logger'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  containsUserFileWithMetadata,
  hydrateUserFilesWithBase64,
} from '@/lib/uploads/utils/user-file-base64.server'
import { sanitizeInputFormat, sanitizeTools } from '@/lib/workflows/comparison/normalize'
import { validateBlockType } from '@/ee/access-control/utils/permission-check'
import {
  BlockType,
  buildResumeApiUrl,
  buildResumeUiUrl,
  DEFAULTS,
  EDGE,
  isSentinelBlockType,
} from '@/executor/constants'
import type { DAGNode } from '@/executor/dag/builder'
import { ChildWorkflowError } from '@/executor/errors/child-workflow-error'
import type { BlockStateWriter, ContextExtensions } from '@/executor/execution/types'
import {
  generatePauseContextId,
  mapNodeMetadataToPauseScopes,
} from '@/executor/human-in-the-loop/utils.ts'
import {
  type BlockHandler,
  type BlockLog,
  type BlockState,
  type ExecutionContext,
  getNextExecutionOrder,
  type NormalizedBlockOutput,
} from '@/executor/types'
import { streamingResponseFormatProcessor } from '@/executor/utils'
import { buildBlockExecutionError, normalizeError } from '@/executor/utils/errors'
import { isJSONString } from '@/executor/utils/json'
import { filterOutputForLog } from '@/executor/utils/output-filter'
import type { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedBlock } from '@/serializer/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'

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

    const blockType = block.metadata?.id ?? ''
    const isSentinel = isSentinelBlockType(blockType)

    let blockLog: BlockLog | undefined
    if (!isSentinel) {
      blockLog = this.createBlockLog(ctx, node.id, block, node)
      ctx.blockLogs.push(blockLog)
      this.callOnBlockStart(ctx, node, block, blockLog.executionOrder)
    }

    const startTime = performance.now()
    let resolvedInputs: Record<string, any> = {}

    const nodeMetadata = this.buildNodeMetadata(node)
    let cleanupSelfReference: (() => void) | undefined

    if (block.metadata?.id === BlockType.HUMAN_IN_THE_LOOP) {
      cleanupSelfReference = this.preparePauseResumeSelfReference(ctx, node, block, nodeMetadata)
    }

    try {
      if (!isSentinel && blockType) {
        await validateBlockType(ctx.userId, blockType, ctx)
      }

      resolvedInputs = this.resolver.resolveInputs(ctx, node.id, block.config.params, block)

      if (blockLog) {
        blockLog.input = this.sanitizeInputsForLog(resolvedInputs)
      }
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
          await this.handleStreamingExecution(
            ctx,
            node,
            block,
            streamingExec,
            resolvedInputs,
            ctx.selectedOutputs ?? []
          )
        }

        normalizedOutput = this.normalizeOutput(
          streamingExec.execution.output ?? streamingExec.execution
        )
      } else {
        normalizedOutput = this.normalizeOutput(output)
      }

      if (containsUserFileWithMetadata(normalizedOutput)) {
        normalizedOutput = (await hydrateUserFilesWithBase64(normalizedOutput, {
          requestId: ctx.metadata.requestId,
          executionId: ctx.executionId,
          maxBytes: ctx.base64MaxBytes,
        })) as NormalizedBlockOutput
      }

      const duration = performance.now() - startTime

      if (blockLog) {
        blockLog.endedAt = new Date().toISOString()
        blockLog.durationMs = duration
        blockLog.success = true
        blockLog.output = filterOutputForLog(block.metadata?.id || '', normalizedOutput, { block })
        if (normalizedOutput.childTraceSpans && Array.isArray(normalizedOutput.childTraceSpans)) {
          blockLog.childTraceSpans = normalizedOutput.childTraceSpans
        }
      }

      this.state.setBlockOutput(node.id, normalizedOutput, duration)

      if (!isSentinel && blockLog) {
        const displayOutput = filterOutputForLog(block.metadata?.id || '', normalizedOutput, {
          block,
        })
        this.callOnBlockComplete(
          ctx,
          node,
          block,
          this.sanitizeInputsForLog(resolvedInputs),
          displayOutput,
          duration,
          blockLog.startedAt,
          blockLog.executionOrder,
          blockLog.endedAt
        )
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
    const duration = performance.now() - startTime
    const errorMessage = normalizeError(error)
    const hasResolvedInputs =
      resolvedInputs && typeof resolvedInputs === 'object' && Object.keys(resolvedInputs).length > 0
    const input =
      hasResolvedInputs && resolvedInputs
        ? resolvedInputs
        : ((block.config?.params as Record<string, any> | undefined) ?? {})

    const errorOutput: NormalizedBlockOutput = {
      error: errorMessage,
    }

    if (ChildWorkflowError.isChildWorkflowError(error)) {
      errorOutput.childTraceSpans = error.childTraceSpans
      errorOutput.childWorkflowName = error.childWorkflowName
      if (error.childWorkflowSnapshotId) {
        errorOutput.childWorkflowSnapshotId = error.childWorkflowSnapshotId
      }
    }

    this.state.setBlockOutput(node.id, errorOutput, duration)

    if (blockLog) {
      blockLog.endedAt = new Date().toISOString()
      blockLog.durationMs = duration
      blockLog.success = false
      blockLog.error = errorMessage
      blockLog.input = this.sanitizeInputsForLog(input)
      blockLog.output = filterOutputForLog(block.metadata?.id || '', errorOutput, { block })

      if (errorOutput.childTraceSpans && Array.isArray(errorOutput.childTraceSpans)) {
        blockLog.childTraceSpans = errorOutput.childTraceSpans
      }
    }

    logger.error(
      phase === 'input_resolution' ? 'Failed to resolve block inputs' : 'Block execution failed',
      {
        blockId: node.id,
        blockType: block.metadata?.id,
        error: errorMessage,
      }
    )

    if (!isSentinel && blockLog) {
      const displayOutput = filterOutputForLog(block.metadata?.id || '', errorOutput, { block })
      this.callOnBlockComplete(
        ctx,
        node,
        block,
        this.sanitizeInputsForLog(input),
        displayOutput,
        duration,
        blockLog.startedAt,
        blockLog.executionOrder,
        blockLog.endedAt
      )
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
      executionOrder: getNextExecutionOrder(ctx),
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

  /**
   * Sanitizes inputs for log display.
   * - Filters out system fields (UI-only, readonly, internal flags)
   * - Removes UI state from inputFormat items (e.g., collapsed)
   * - Parses JSON strings to objects for readability
   * Returns a new object - does not mutate the original inputs.
   */
  private sanitizeInputsForLog(inputs: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(inputs)) {
      if (SYSTEM_SUBBLOCK_IDS.includes(key) || key === 'triggerMode') {
        continue
      }

      if (key === 'inputFormat' && Array.isArray(value)) {
        result[key] = sanitizeInputFormat(value)
        continue
      }

      if (key === 'tools' && Array.isArray(value)) {
        result[key] = sanitizeTools(value)
        continue
      }

      // isJSONString is a quick heuristic (checks for { or [), not a validator.
      // Invalid JSON is safely caught below - this just avoids JSON.parse on every string.
      if (typeof value === 'string' && isJSONString(value)) {
        try {
          result[key] = JSON.parse(value.trim())
        } catch {
          // Not valid JSON, keep original string
          result[key] = value
        }
      } else {
        result[key] = value
      }
    }

    return result
  }

  private callOnBlockStart(
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock,
    executionOrder: number
  ): void {
    const blockId = node.id
    const blockName = block.metadata?.name ?? blockId
    const blockType = block.metadata?.id ?? DEFAULTS.BLOCK_TYPE

    const iterationContext = this.getIterationContext(ctx, node)

    if (this.contextExtensions.onBlockStart) {
      this.contextExtensions.onBlockStart(
        blockId,
        blockName,
        blockType,
        executionOrder,
        iterationContext
      )
    }
  }

  private callOnBlockComplete(
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock,
    input: Record<string, any>,
    output: NormalizedBlockOutput,
    duration: number,
    startedAt: string,
    executionOrder: number,
    endedAt: string
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
          startedAt,
          executionOrder,
          endedAt,
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
        resumeEndpoint: resumeLinks.apiUrl,
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

  private async handleStreamingExecution(
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock,
    streamingExec: { stream: ReadableStream; execution: any },
    resolvedInputs: Record<string, any>,
    selectedOutputs: string[]
  ): Promise<void> {
    const blockId = node.id

    const responseFormat =
      resolvedInputs?.responseFormat ??
      (block.config?.params as Record<string, any> | undefined)?.responseFormat ??
      (block.config as Record<string, any> | undefined)?.responseFormat

    const stream = streamingExec.stream
    if (typeof stream.tee !== 'function') {
      await this.forwardStream(ctx, blockId, streamingExec, stream, responseFormat, selectedOutputs)
      return
    }

    const [clientStream, executorStream] = stream.tee()

    const processedClientStream = streamingResponseFormatProcessor.processStream(
      clientStream,
      blockId,
      selectedOutputs,
      responseFormat
    )

    const clientStreamingExec = {
      ...streamingExec,
      stream: processedClientStream,
    }

    const executorConsumption = this.consumeExecutorStream(
      executorStream,
      streamingExec,
      blockId,
      responseFormat
    )

    const clientConsumption = (async () => {
      try {
        await ctx.onStream?.(clientStreamingExec)
      } catch (error) {
        logger.error('Error in onStream callback', { blockId, error })
      }
    })()

    await Promise.all([clientConsumption, executorConsumption])
  }

  private async forwardStream(
    ctx: ExecutionContext,
    blockId: string,
    streamingExec: { stream: ReadableStream; execution: any },
    stream: ReadableStream,
    responseFormat: any,
    selectedOutputs: string[]
  ): Promise<void> {
    const processedStream = streamingResponseFormatProcessor.processStream(
      stream,
      blockId,
      selectedOutputs,
      responseFormat
    )

    try {
      await ctx.onStream?.({
        ...streamingExec,
        stream: processedStream,
      })
    } catch (error) {
      logger.error('Error in onStream callback', { blockId, error })
    }
  }

  private async consumeExecutorStream(
    stream: ReadableStream,
    streamingExec: { execution: any },
    blockId: string,
    responseFormat: any
  ): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullContent += decoder.decode(value, { stream: true })
      }
    } catch (error) {
      logger.error('Error reading executor stream for block', { blockId, error })
    } finally {
      try {
        reader.releaseLock()
      } catch {}
    }

    if (!fullContent) {
      return
    }

    const executionOutput = streamingExec.execution?.output
    if (!executionOutput || typeof executionOutput !== 'object') {
      return
    }

    if (responseFormat) {
      try {
        const parsed = JSON.parse(fullContent.trim())

        streamingExec.execution.output = {
          ...parsed,
          tokens: executionOutput.tokens,
          toolCalls: executionOutput.toolCalls,
          providerTiming: executionOutput.providerTiming,
          cost: executionOutput.cost,
          model: executionOutput.model,
        }
        return
      } catch (error) {
        logger.warn('Failed to parse streamed content for response format', { blockId, error })
      }
    }

    executionOutput.content = fullContent
  }
}
