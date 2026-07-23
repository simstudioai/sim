import { createLogger, type Logger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { normalizeStringArray } from '@/lib/core/utils/arrays'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { redactLargeValueRefsInValue } from '@/lib/logs/execution/pii-large-values'
import { redactObjectStrings } from '@/lib/logs/execution/pii-redaction'
import {
  containsUserFileWithMetadata,
  hydrateUserFilesWithBase64,
} from '@/lib/uploads/utils/user-file-base64.server'
import { sanitizeInputFormat, sanitizeTools } from '@/lib/workflows/comparison/normalize'
import { isCustomBlockType } from '@/blocks/custom/build-config'
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
  buildBranchNodeId,
  buildOuterBranchScopedId,
  extractOuterBranchIndex,
} from '@/executor/utils/subflow-utils'
import {
  FUNCTION_BLOCK_CONTEXT_VARS_KEY,
  FUNCTION_BLOCK_DISPLAY_CODE_KEY,
  type VariableResolver,
} from '@/executor/variables/resolver'
import { createAgentStreamPump } from '@/providers/stream-pump'
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
    let blockStartPromise: Promise<void> | undefined
    if (!isSentinel) {
      blockLog = this.createBlockLog(ctx, node.id, block, node, startedAt)
      ctx.blockLogs.push(blockLog)
      blockStartPromise = this.fireBlockStartCallback(ctx, node, block, blockLog.executionOrder)
      await blockStartPromise
    }

    let resolvedInputs: Record<string, any> = {}
    let inputsForLog: Record<string, any> = {}

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
        const {
          resolvedInputs: fnInputs,
          displayInputs,
          contextVariables,
        } = await this.resolver.resolveInputsForFunctionBlock(
          ctx,
          node.id,
          block.config.params,
          block
        )
        resolvedInputs = {
          ...fnInputs,
          [FUNCTION_BLOCK_CONTEXT_VARS_KEY]: contextVariables,
          ...(displayInputs.code !== undefined
            ? { [FUNCTION_BLOCK_DISPLAY_CODE_KEY]: displayInputs.code }
            : {}),
        }
        inputsForLog = displayInputs
      } else {
        resolvedInputs = await this.resolver.resolveInputs(ctx, node.id, block.config.params, block)
        inputsForLog = resolvedInputs
      }

      if (blockLog) {
        blockLog.input = this.sanitizeInputsForLog(inputsForLog, block.metadata?.id)
      }
    } catch (error) {
      cleanupSelfReference?.()
      return await this.handleBlockError(
        error,
        ctx,
        node,
        block,
        blockStartPromise,
        startTime,
        blockLog,
        inputsForLog,
        isSentinel,
        'input_resolution'
      )
    }
    cleanupSelfReference?.()

    let streamingPartialOutput: Record<string, any> | undefined
    try {
      const output = handler.executeWithNode
        ? await handler.executeWithNode(ctx, block, resolvedInputs, nodeMetadata)
        : await handler.execute(ctx, block, resolvedInputs)

      const isStreamingExecution =
        output && typeof output === 'object' && 'stream' in output && 'execution' in output

      let normalizedOutput: NormalizedBlockOutput
      if (isStreamingExecution) {
        const streamingExec = output as StreamingExecution

        // Always drain via the agent stream pump (tokens/cost/timing callbacks),
        // even with no `onStream`. When block-output redaction is on we do not
        // live-forward chunks; content is masked before persist and the masked
        // final output reaches the client via block-complete.
        try {
          await this.handleStreamingExecution(
            ctx,
            node,
            block,
            streamingExec,
            resolvedInputs,
            normalizeStringArray(ctx.selectedOutputs)
          )
        } catch (streamError) {
          // Timeout / drain failures may still have projected answer text — keep it
          // for the failed block output so logs match what the client already saw.
          streamingPartialOutput = streamingExec.execution?.output
          throw streamError
        }

        normalizedOutput = this.normalizeOutput(
          streamingExec.execution.output ?? streamingExec.execution
        )
      } else {
        normalizedOutput = this.normalizeOutput(output)
      }

      if (ctx.includeFileBase64 === true && containsUserFileWithMetadata(normalizedOutput)) {
        normalizedOutput = (await hydrateUserFilesWithBase64(normalizedOutput, {
          requestId: ctx.metadata.requestId,
          workspaceId: ctx.workspaceId,
          workflowId: ctx.workflowId,
          executionId: ctx.executionId,
          largeValueExecutionIds: ctx.largeValueExecutionIds,
          largeValueKeys: ctx.largeValueKeys,
          fileKeys: ctx.fileKeys,
          allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
          userId: ctx.userId,
          maxBytes: ctx.base64MaxBytes,
          preserveLargeValueMetadata: true,
        })) as NormalizedBlockOutput
      }

      if (ctx.piiBlockOutputRedaction?.enabled) {
        // In-flight redaction before the log/state split below, so both the
        // downstream state copy and the persisted log copy are masked.
        // `onFailure: 'throw'` aborts the run rather than feeding corrupted/leaked
        // data downstream.
        const redactionOptions = {
          entityTypes: ctx.piiBlockOutputRedaction.entityTypes,
          language: ctx.piiBlockOutputRedaction.language,
          customPatterns: ctx.piiBlockOutputRedaction.customPatterns,
          onFailure: 'throw' as const,
        }
        // Tools like the function executor offload large outputs to large-value
        // refs BEFORE they reach here, and the string walk treats a ref as opaque.
        // So hydrate → mask → re-store any refs first, then mask inline strings —
        // otherwise PII inside an offloaded output is never redacted.
        normalizedOutput = await redactLargeValueRefsInValue(normalizedOutput, {
          ...redactionOptions,
          store: {
            workspaceId: ctx.workspaceId,
            workflowId: ctx.workflowId,
            executionId: ctx.executionId,
            userId: ctx.userId,
          },
        })
        normalizedOutput = await redactObjectStrings(normalizedOutput, redactionOptions)
      }

      normalizedOutput = (await compactExecutionPayload(normalizedOutput, {
        workspaceId: ctx.workspaceId,
        workflowId: ctx.workflowId,
        executionId: ctx.executionId,
        userId: ctx.userId,
        preserveUserFileBase64: ctx.includeFileBase64 === true,
        requireDurable: true,
      })) as NormalizedBlockOutput

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
      this.setNodeOutput(node, outputForState as NormalizedBlockOutput, duration)

      if (!isSentinel && blockLog) {
        const childWorkflowInstanceId =
          typeof normalizedOutput._childWorkflowInstanceId === 'string'
            ? normalizedOutput._childWorkflowInstanceId
            : undefined
        const displayOutput = filterOutputForLog(block.metadata?.id || '', normalizedOutput, {
          block,
        })
        this.fireBlockCompleteCallback(
          blockStartPromise,
          ctx,
          node,
          block,
          this.sanitizeInputsForLog(inputsForLog, block.metadata?.id),
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
        blockStartPromise,
        startTime,
        blockLog,
        inputsForLog,
        isSentinel,
        'execution',
        streamingPartialOutput
      )
    }
  }

  private buildNodeMetadata(node: DAGNode): WorkflowNodeMetadata {
    const metadata = node?.metadata ?? {}
    return {
      nodeId: node.id,
      loopId: metadata.subflowType === 'loop' ? metadata.subflowId : undefined,
      parallelId: metadata.subflowType === 'parallel' ? metadata.subflowId : undefined,
      subflowId: metadata.subflowId,
      subflowType: metadata.subflowType,
      branchIndex: metadata.branchIndex,
      branchTotal: metadata.branchTotal,
      originalBlockId: metadata.originalBlockId,
      isLoopNode: metadata.isLoopNode,
    }
  }

  private setNodeOutput(node: DAGNode, output: NormalizedBlockOutput, duration = 0): void {
    this.state.setBlockOutput(node.id, output, duration)

    const originalBlockId = node.metadata.originalBlockId
    const branchIndex = node.metadata.branchIndex
    if (
      node.metadata.isParallelBranch &&
      originalBlockId &&
      branchIndex !== undefined &&
      extractOuterBranchIndex(node.id) === undefined
    ) {
      const globalBranchNodeId = buildBranchNodeId(originalBlockId, branchIndex)
      if (globalBranchNodeId !== node.id) {
        this.state.setBlockOutput(globalBranchNodeId, output, duration)
      }
      this.state.setBlockOutput(
        buildOuterBranchScopedId(originalBlockId, branchIndex),
        output,
        duration
      )
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
    blockStartPromise: Promise<void> | undefined,
    startTime: number,
    blockLog: BlockLog | undefined,
    inputsForLog: Record<string, any>,
    isSentinel: boolean,
    phase: 'input_resolution' | 'execution',
    streamingPartialOutput?: Record<string, any>
  ): Promise<NormalizedBlockOutput> {
    const endedAt = new Date().toISOString()
    const duration = performance.now() - startTime
    const errorMessage = normalizeError(error)
    const hasLogInputs =
      inputsForLog && typeof inputsForLog === 'object' && Object.keys(inputsForLog).length > 0
    const input = hasLogInputs
      ? inputsForLog
      : ((block.config?.params as Record<string, any> | undefined) ?? {})

    // Routine user Stop on Agent streams: don't paint a failed agent block
    // (workflow is already cancelled). Timeouts abort with reason `'timeout'`.
    // Non-agent blocks (HTTP, Function, etc.) still fail normally on AbortError
    // so logs don't show a green empty success.
    const isAbort =
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    const isTimeout = ctx.abortSignal?.reason === 'timeout'
    const isAgentBlock = block.metadata?.id === BlockType.AGENT
    if (isAbort && !isTimeout && ctx.abortSignal?.aborted && isAgentBlock) {
      const softOutput: NormalizedBlockOutput = {
        content: '',
      }

      this.setNodeOutput(node, softOutput, duration)

      if (blockLog) {
        blockLog.endedAt = endedAt
        blockLog.durationMs = duration
        blockLog.success = true
        blockLog.error = undefined
        blockLog.input = this.sanitizeInputsForLog(input, block.metadata?.id)
        blockLog.output = filterOutputForLog(block.metadata?.id || '', softOutput, { block })
      }

      this.execLogger.info('Block stream aborted by client; soft-completing', {
        blockId: node.id,
        blockType: block.metadata?.id,
      })

      if (!isSentinel && blockLog) {
        this.fireBlockCompleteCallback(
          blockStartPromise,
          ctx,
          node,
          block,
          this.sanitizeInputsForLog(input, block.metadata?.id),
          filterOutputForLog(block.metadata?.id || '', softOutput, { block }),
          duration,
          blockLog.startedAt,
          blockLog.executionOrder,
          blockLog.endedAt
        )
      }

      return softOutput
    }

    const errorOutput: NormalizedBlockOutput = {
      error: errorMessage,
    }

    // Keep any answer text already drained before timeout/failure so logs match
    // what was projected to the client.
    const partialContent = streamingPartialOutput?.content
    if (typeof partialContent === 'string' && partialContent) {
      errorOutput.content = partialContent
    }

    if (ChildWorkflowError.isChildWorkflowError(error)) {
      errorOutput.childWorkflowName = error.childWorkflowName
      if (error.childWorkflowSnapshotId) {
        errorOutput.childWorkflowSnapshotId = error.childWorkflowSnapshotId
      }
    }

    this.setNodeOutput(node, errorOutput, duration)

    if (blockLog) {
      blockLog.endedAt = endedAt
      blockLog.durationMs = duration
      blockLog.success = false
      blockLog.error = errorMessage
      blockLog.input = this.sanitizeInputsForLog(input, block.metadata?.id)
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
        blockStartPromise,
        ctx,
        node,
        block,
        this.sanitizeInputsForLog(input, block.metadata?.id),
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
      if (
        node.metadata.branchIndex !== undefined &&
        node.metadata.subflowType === 'parallel' &&
        node.metadata.subflowId
      ) {
        blockName = `${blockName} (iteration ${node.metadata.branchIndex})`
        iterationIndex = node.metadata.branchIndex
        parallelId = node.metadata.subflowId
      } else if (
        node.metadata.isLoopNode &&
        node.metadata.subflowType === 'loop' &&
        node.metadata.subflowId
      ) {
        loopId = node.metadata.subflowId
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
  private sanitizeInputsForLog(
    inputs: Record<string, any>,
    blockType?: string
  ): Record<string, any> {
    // Custom (deploy-as-block) blocks run via an internal `workflow_executor`; the
    // baked `workflowId`/`inputMapping` wrapper is plumbing. Log the mapped input
    // field values (the inputMapping contents) instead.
    if (isCustomBlockType(blockType)) {
      const mapping = inputs.inputMapping
      const parsed =
        typeof mapping === 'string'
          ? (() => {
              try {
                return JSON.parse(mapping)
              } catch {
                return {}
              }
            })()
          : mapping
      inputs = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    }

    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(inputs)) {
      if (
        SYSTEM_SUBBLOCK_IDS.includes(key) ||
        key === 'triggerMode' ||
        key === FUNCTION_BLOCK_CONTEXT_VARS_KEY ||
        key === FUNCTION_BLOCK_DISPLAY_CODE_KEY
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
   * Fires the `onBlockStart` progress callback before block execution continues.
   * Returning the promise lets completion callbacks preserve lifecycle ordering.
   */
  private fireBlockStartCallback(
    ctx: ExecutionContext,
    node: DAGNode,
    block: SerializedBlock,
    executionOrder: number
  ): Promise<void> | undefined {
    if (!this.contextExtensions.onBlockStart) return undefined

    const blockId = node.metadata?.originalBlockId ?? node.id
    const blockName = block.metadata?.name ?? blockId
    const blockType = block.metadata?.id ?? DEFAULTS.BLOCK_TYPE
    const iterationContext = getIterationContext(ctx, node?.metadata)

    return this.contextExtensions
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
   * Completion is chained behind the matching start callback so SSE/log consumers
   * never observe `block:completed` before `block:started` for the same execution.
   */
  private fireBlockCompleteCallback(
    blockStartPromise: Promise<void> | undefined,
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

    void (async () => {
      await blockStartPromise
      await this.contextExtensions.onBlockComplete?.(
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
    })().catch((error) => {
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
    const piiEnabled = Boolean(ctx.piiBlockOutputRedaction?.enabled)
    // Live-forward only when a client stream exists and PII redaction is off.
    const forwardToClient = Boolean(ctx.onStream) && !piiEnabled

    const responseFormat =
      resolvedInputs?.responseFormat ??
      (block.config?.params as Record<string, any> | undefined)?.responseFormat ??
      (block.config as Record<string, any> | undefined)?.responseFormat

    const streamFormat = streamingExec.streamFormat ?? 'text'
    const pump = createAgentStreamPump({
      source: streamingExec.stream,
      streamFormat,
      // No live consumer → sink-mode so we never buffer into an unread text stream.
      sinkMode: !forwardToClient,
      abortSignal: ctx.abortSignal,
    })

    let onStreamPromise: Promise<void> | undefined
    let processedClientStream: ReadableStream<Uint8Array> | undefined

    if (forwardToClient && ctx.onStream && pump.textStream) {
      processedClientStream = streamingResponseFormatProcessor.processStream(
        pump.textStream,
        blockId,
        selectedOutputs,
        responseFormat
      )

      // Start onStream without awaiting so a sync `subscribe(sink)` can run before
      // the first provider pull, then read the projected text stream concurrently
      // with `pump.run()`.
      onStreamPromise = ctx
        .onStream({
          ...streamingExec,
          stream: processedClientStream,
          streamFormat: 'text',
          subscribe: pump.subscribe,
        })
        .catch(async (error) => {
          this.execLogger.error('Error in onStream callback', { blockId, error })
          await processedClientStream?.cancel().catch(() => {})
        })
    }

    let pumpResult
    try {
      pumpResult = await pump.run()
    } catch (error) {
      this.execLogger.error('Error reading stream for block', { blockId, error })
      if (onStreamPromise) {
        await onStreamPromise.catch(() => {})
      }
      throw error instanceof Error ? error : new Error(String(error))
    }

    if (onStreamPromise) {
      await onStreamPromise
    }

    // Timeout still fails the block, but keep any drained answer text so logs
    // match what was already projected to the client before the deadline.
    // User Stop soft-completes below so logs don't show a scary red agent block
    // for a routine cancel (workflow status remains `cancelled` via abort).
    if (pumpResult.cancelled && pumpResult.cancelReason === 'timeout') {
      const truncated = pumpResult.answerText
      if (truncated && streamingExec.execution?.output) {
        streamingExec.execution.output.content = truncated
      }
      this.execLogger.warn('Stream timed out; persisting drained answer before failing block', {
        blockId,
        hasContent: Boolean(truncated),
      })
      throw new DOMException('Provider request timed out', 'AbortError')
    }

    // Provider onComplete may have attached thinking to timing segments during drain.
    // Under PII redaction, never retain raw thinking in traces.
    if (piiEnabled) {
      stripThinkingContentFromOutput(streamingExec.execution?.output)
    }

    // User/unknown cancel: persist truncated answer when present, then return.
    if (pumpResult.cancelled) {
      const truncated = pumpResult.answerText
      if (truncated && streamingExec.execution?.output) {
        streamingExec.execution.output.content = truncated
      }
      this.execLogger.info('Stream cancelled by client; soft-completing agent block', {
        blockId,
        cancelReason: pumpResult.cancelReason,
        hasContent: Boolean(truncated),
      })
      return
    }

    // If the pump did not fully drain (should be rare when not cancelled), skip
    // persistence of potentially truncated answer text.
    if (!pumpResult.fullyDrained) {
      this.execLogger.warn(
        'Stream consumer exited before source drained; skipping content persistence',
        { blockId }
      )
      return
    }

    let fullContent = pumpResult.answerText
    if (!fullContent) {
      return
    }

    if (piiEnabled && ctx.piiBlockOutputRedaction) {
      // Mask before writing to `execution.output` or `onFullContent`.
      fullContent = await redactObjectStrings(fullContent, {
        entityTypes: ctx.piiBlockOutputRedaction.entityTypes,
        language: ctx.piiBlockOutputRedaction.language,
        customPatterns: ctx.piiBlockOutputRedaction.customPatterns,
        onFailure: 'throw',
      })
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

/** Removes retained thinking from provider timing segments (PII safe default). */
function stripThinkingContentFromOutput(output: unknown): void {
  if (!output || typeof output !== 'object') return
  const providerTiming = (output as { providerTiming?: { timeSegments?: unknown } }).providerTiming
  const segments = providerTiming?.timeSegments
  if (!Array.isArray(segments)) return
  for (const segment of segments) {
    if (segment && typeof segment === 'object' && 'thinkingContent' in segment) {
      ;(segment as { thinkingContent?: string }).thinkingContent = undefined
    }
  }
}
