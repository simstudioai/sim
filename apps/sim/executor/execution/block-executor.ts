import { createLogger, type Logger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { redactApiKeys } from '@/lib/core/security/redaction'
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
import type {
  BlockStateWriter,
  ContextExtensions,
  WorkflowNodeMetadata,
} from '@/executor/execution/types'
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
  type StreamingExecution,
} from '@/executor/types'
import { streamingResponseFormatProcessor } from '@/executor/utils'
import { buildBlockExecutionError, normalizeError } from '@/executor/utils/errors'
import {
  buildUnifiedParentIterations,
  getIterationContext,
} from '@/executor/utils/iteration-context'
import { isJSONString } from '@/executor/utils/json'
import { filterOutputForLog } from '@/executor/utils/output-filter'
import {
  FUNCTION_BLOCK_CONTEXT_VARS_KEY,
  type VariableResolver,
} from '@/executor/variables/resolver'
import type { SerializedBlock } from '@/serializer/types'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'

const logger = createLogger('BlockExecutor')

export class BlockExecutor {
  private execLogger: Logger

  constructor(
    private blockHandlers: BlockHandler[],
    private resolver: VariableResolver,
    private contextExtensions: ContextExtensions,
    private state: BlockStateWriter
  ) {
    this.execLogger = logger.withMetadata({
      workflowId: this.contextExtensions.metadata?.workflowId,
      workspaceId: this.contextExtensions.workspaceId,
      executionId: this.contextExtensions.executionId,
      userId: this.contextExtensions.userId,
      requestId: this.contextExtensions.metadata?.requestId,
    })
  }

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

    // Capture startedAt and startTime at the same synchronous instant so
    // blockLog.startedAt and performance.now()-derived durationMs share a
    // single reference point. Any executor work below counts toward this block.
    const startedAt = new Date().toISOString()
    const startTime = performance.now()

    let blockLog: BlockLog | undefined
    if (!isSentinel) {
      blockLog = this.createBlockLog(ctx, node.id, block, node, startedAt)
      ctx.blockLogs.push(blockLog)
      this.fireBlockStartCallback(ctx, node, block, blockLog.executionOrder)
    }

    let resolvedInputs: Record<string, any> = {}

    const nodeMetadata = {
      ...this.buildNodeMetadata(node),
      executionOrder: blockLog?.executionOrder,
    }
    let cleanupSelfReference: (() => void) | undefined

    if (block.metadata?.id === BlockType.HUMAN_IN_THE_LOOP) {
      cleanupSelfReference = this.preparePauseResumeSelfReference(ctx, node, block, nodeMetadata)
    }

    try {
      if (!isSentinel && blockType) {
        await validateBlockType(ctx.userId, ctx.workspaceId, blockType, ctx)
      }

      if (block.metadata?.id === BlockType.FUNCTION) {
        const { resolvedInputs: fnInputs, contextVariables } =
          this.resolver.resolveInputsForFunctionBlock(ctx, node.id, block.config.params, block)
        resolvedInputs = { ...fnInputs, [FUNCTION_BLOCK_CONTEXT_VARS_KEY]: contextVariables }
      } else {
        resolvedInputs = this.resolver.resolveInputs(ctx, node.id, block.config.params, block)
      }

      if (blockLog) {
        blockLog.input = this.sanitizeInputsForLog(resolvedInputs)
      }
    } catch (error) {
      cleanupSelfReference?.()
      return await this.handleBlockError(
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
        const streamingExec = output as StreamingExecution

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

      const endedAt = new Date().toISOString()
      const duration = performance.now() - startTime

      if (blockLog) {
        blockLog.endedAt = endedAt
        blockLog.durationMs = duration
        blockLog.success = true
        blockLog.output = filterOutputForLog(block.metadata?.id || '', normalizedOutput, { block })
        if (normalizedOutput.childTraceSpans && Array.isArray(normalizedOutput.childTraceSpans)) {
          blockLog.childTraceSpans = normalizedOutput.childTraceSpans
        }
      }

      const { childTraceSpans: _traces, ...outputForState } = normalizedOutput
      this.state.setBlockOutput(node.id, outputForState as NormalizedBlockOutput, duration)

      if (!isSentinel && blockLog) {
        const childWorkflowInstanceId =
          typeof normalizedOutput._childWorkflowInstanceId === 'string'
            ? normalizedOutput._childWorkflowInstanceId
            : undefined
        const displayOutput = filterOutputForLog(block.metadata?.id || '', normalizedOutput, {
          block,
        })
        this.fireBlockCompleteCallback(
          ctx,
          node,
          block,
          this.sanitizeInputsForLog(resolvedInputs),
          displayOutput,
          duration,
          blockLog.startedAt,
          blockLog.executionOrder,
          blockLog.endedAt,
          childWorkflowInstanceId
        )
      }

      return outputForState as NormalizedBlockOutput
    } catch (error) {
      return await this.handleBlockError(
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

  private buildNodeMetadata(node: DAGNode): WorkflowNodeMetadata {
    const metadata = node?.metadata ?? {}
    return {
      nodeId: node.id,
      loopId: metadata.loopId,
      parallelId: metadata.parallelId,
      branchIndex: metadata.branchIndex,
      branchTotal: metadata.branchTotal,
      originalBlockId: metadata.originalBlockId,
      isLoopNode: metadata.isLoopNode,
    }
  }

  private findHandler(block: SerializedBlock): BlockHandler | undefined {
    return this.blockHandlers.find((h) => h.canHandle(block))
  }

  private async handleBlockError(
    error: unknown,
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock,
    startTime: number,
    blockLog: BlockLog | undefined,
    resolvedInputs: Record<string, any>,
    isSentinel: boolean,
    phase: 'input_resolution' | 'execution'
  ): Promise<NormalizedBlockOutput> {
    const endedAt = new Date().toISOString()
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
      errorOutput.childWorkflowName = error.childWorkflowName
      if (error.childWorkflowSnapshotId) {
        errorOutput.childWorkflowSnapshotId = error.childWorkflowSnapshotId
      }
    }

    this.state.setBlockOutput(node.id, errorOutput, duration)

    if (blockLog) {
      blockLog.endedAt = endedAt
      blockLog.durationMs = duration
      blockLog.success = false
      blockLog.error = errorMessage
      blockLog.input = this.sanitizeInputsForLog(input)
      blockLog.output = filterOutputForLog(block.metadata?.id || '', errorOutput, { block })

      if (ChildWorkflowError.isChildWorkflowError(error) && error.childTraceSpans.length > 0) {
        blockLog.childTraceSpans = error.childTraceSpans
      }
    }

    this.execLogger.error(
      phase === 'input_resolution' ? 'Failed to resolve block inputs' : 'Block execution failed',
      {
        blockId: node.id,
        blockType: block.metadata?.id,
        error: errorMessage,
      }
    )

    if (!isSentinel && blockLog) {
      const childWorkflowInstanceId = ChildWorkflowError.isChildWorkflowError(error)
        ? error.childWorkflowInstanceId
        : undefined
      const displayOutput = filterOutputForLog(block.metadata?.id || '', errorOutput, { block })
      this.fireBlockCompleteCallback(
        ctx,
        node,
        block,
        this.sanitizeInputsForLog(input),
        displayOutput,
        duration,
        blockLog.startedAt,
        blockLog.executionOrder,
        blockLog.endedAt,
        childWorkflowInstanceId
      )
    }

    const hasErrorPort = this.hasErrorPortEdge(node)
    if (hasErrorPort) {
      if (blockLog) {
        blockLog.errorHandled = true
      }
      this.execLogger.info('Block has error port - returning error output instead of throwing', {
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
    node: DAGNode,
    startedAt: string
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
          this.execLogger.warn('Loop scope not found for block', { blockId, loopId })
        }
      }
    }

    const containerId = parallelId ?? loopId
    const parentIterations = containerId
      ? buildUnifiedParentIterations(ctx, containerId)
      : undefined

    return {
      blockId,
      blockName,
      blockType: block.metadata?.id ?? DEFAULTS.BLOCK_TYPE,
      startedAt,
      executionOrder: getNextExecutionOrder(ctx),
      endedAt: '',
      durationMs: 0,
      success: false,
      loopId,
      parallelId,
      iterationIndex,
      ...(parentIterations?.length && { parentIterations }),
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
   * - Redacts sensitive fields (privateKey, password, tokens, etc.)
   * Returns a new object - does not mutate the original inputs.
   */
  private sanitizeInputsForLog(inputs: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(inputs)) {
      if (
        SYSTEM_SUBBLOCK_IDS.includes(key) ||
        key === 'triggerMode' ||
        key === FUNCTION_BLOCK_CONTEXT_VARS_KEY
      ) {
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

    return redactApiKeys(result)
  }

  /**
   * Fires the `onBlockStart` progress callback without blocking block execution.
   * Any error is logged and swallowed so callback I/O never stalls the critical path.
   */
  private fireBlockStartCallback(
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock,
    executionOrder: number
  ): void {
    if (!this.contextExtensions.onBlockStart) return

    const blockId = node.metadata?.originalBlockId ?? node.id
    const blockName = block.metadata?.name ?? blockId
    const blockType = block.metadata?.id ?? DEFAULTS.BLOCK_TYPE
    const iterationContext = getIterationContext(ctx, node?.metadata)

    void this.contextExtensions
      .onBlockStart(
        blockId,
        blockName,
        blockType,
        executionOrder,
        iterationContext,
        ctx.childWorkflowContext
      )
      .catch((error) => {
        this.execLogger.warn('Block start callback failed', {
          blockId,
          blockType,
          error: toError(error).message,
        })
      })
  }

  /**
   * Fires the `onBlockComplete` progress callback without blocking subsequent blocks.
   * The callback typically performs DB writes for progress markers — awaiting it would
   * add latency between blocks and skew wall-clock timing in the trace view.
   */
  private fireBlockCompleteCallback(
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock,
    input: Record<string, any>,
    output: NormalizedBlockOutput,
    duration: number,
    startedAt: string,
    executionOrder: number,
    endedAt: string,
    childWorkflowInstanceId?: string
  ): void {
    if (!this.contextExtensions.onBlockComplete) return

    const blockId = node.metadata?.originalBlockId ?? node.id
    const blockName = block.metadata?.name ?? blockId
    const blockType = block.metadata?.id ?? DEFAULTS.BLOCK_TYPE
    const iterationContext = getIterationContext(ctx, node?.metadata)

    void this.contextExtensions
      .onBlockComplete(
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
          childWorkflowInstanceId,
        },
        iterationContext,
        ctx.childWorkflowContext
      )
      .catch((error) => {
        this.execLogger.warn('Block completion callback failed', {
          blockId,
          blockType,
          error: toError(error).message,
        })
      })
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
    streamingExec: StreamingExecution,
    resolvedInputs: Record<string, any>,
    selectedOutputs: string[]
  ): Promise<void> {
    const blockId = node.id

    const responseFormat =
      resolvedInputs?.responseFormat ??
      (block.config?.params as Record<string, any> | undefined)?.responseFormat ??
      (block.config as Record<string, any> | undefined)?.responseFormat

    const sourceReader = streamingExec.stream.getReader()
    const decoder = new TextDecoder()
    const accumulated: string[] = []
    let drainError: unknown
    let sourceFullyDrained = false

    const clientSource = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await sourceReader.read()
          if (done) {
            const tail = decoder.decode()
            if (tail) accumulated.push(tail)
            sourceFullyDrained = true
            controller.close()
            return
          }
          accumulated.push(decoder.decode(value, { stream: true }))
          controller.enqueue(value)
        } catch (error) {
          drainError = error
          controller.error(error)
        }
      },
      async cancel(reason) {
        try {
          await sourceReader.cancel(reason)
        } catch {}
      },
    })

    const processedClientStream = streamingResponseFormatProcessor.processStream(
      clientSource,
      blockId,
      selectedOutputs,
      responseFormat
    )

    try {
      await ctx.onStream?.({
        stream: processedClientStream,
        execution: streamingExec.execution,
      })
    } catch (error) {
      this.execLogger.error('Error in onStream callback', { blockId, error })
      await processedClientStream.cancel().catch(() => {})
    } finally {
      try {
        sourceReader.releaseLock()
      } catch {}
    }

    if (drainError) {
      this.execLogger.error('Error reading stream for block', { blockId, error: drainError })
      return
    }

    // If the onStream consumer exited before the source drained (e.g. it caught
    // an internal error and returned normally), `accumulated` holds a truncated
    // response. Persisting that to memory or setting it as the block output
    // would corrupt downstream state — skip and log instead.
    if (!sourceFullyDrained) {
      this.execLogger.warn(
        'Stream consumer exited before source drained; skipping content persistence',
        {
          blockId,
        }
      )
      return
    }

    const fullContent = accumulated.join('')
    if (!fullContent) {
      return
    }

    const executionOutput = streamingExec.execution?.output
    if (executionOutput && typeof executionOutput === 'object') {
      let parsedForFormat = false
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
          parsedForFormat = true
        } catch (error) {
          this.execLogger.warn('Failed to parse streamed content for response format', {
            blockId,
            error,
          })
        }
      }
      if (!parsedForFormat) {
        executionOutput.content = fullContent
      }
    }

    if (streamingExec.onFullContent) {
      try {
        await streamingExec.onFullContent(fullContent)
      } catch (error) {
        this.execLogger.error('onFullContent callback failed', { blockId, error })
      }
    }
  }
}
