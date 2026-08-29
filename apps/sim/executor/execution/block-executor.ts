import { createLogger, type Logger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { isTimeoutAbortReason } from '@/lib/core/execution-limits/types'
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
  CHILD_EXECUTION_ID_OUTPUT_KEY,
  CHILD_TRACE_DISABLED_OUTPUT_KEY,
  DEFAULTS,
  EDGE,
  isSentinelBlockType,
  isWorkflowBlockType,
} from '@/executor/constants'
import type { DAGNode } from '@/executor/dag/builder'
import { ChildWorkflowError } from '@/executor/errors/child-workflow-error'
import { isRetryableBlockError, resolveBlockRetryPolicy } from '@/executor/execution/block-retry'
import type {
  BlockStateWriter,
  ContextExtensions,
  WorkflowNodeMetadata,
} from '@/executor/execution/types'
import {
  assertStructuredOutputNotTokenLimited,
  parseResponseFormat,
  StructuredOutputTokenLimitError,
} from '@/executor/handlers/shared/response-format'
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
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'
import type {
  ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
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
import { enrichLastModelSegment } from '@/providers/trace-enrichment'
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

    const parentResolvedSecretTraceRegistry = ctx.resolvedSecretTraceRegistry
    const blockResolvedSecretTraceRegistry = parentResolvedSecretTraceRegistry?.forkForInputPaths(
      []
    )
    const inputDisplayRegistry = blockResolvedSecretTraceRegistry
    const blockCtx = blockResolvedSecretTraceRegistry
      ? { ...ctx, resolvedSecretTraceRegistry: blockResolvedSecretTraceRegistry }
      : ctx
    let registryCommitted = false
    const commitBlockRegistry = () => {
      const settledBlockRegistry = blockCtx.resolvedSecretTraceRegistry
      if (registryCommitted || !parentResolvedSecretTraceRegistry || !settledBlockRegistry) {
        return
      }
      registryCommitted = true
      if (settledBlockRegistry.isComplete()) {
        parentResolvedSecretTraceRegistry.mergeToolCallRegistry(settledBlockRegistry)
      }
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
      blockLog = this.createBlockLog(blockCtx, node.id, block, node, startedAt)
      blockCtx.blockLogs.push(blockLog)
      blockStartPromise = this.fireBlockStartCallback(
        blockCtx,
        node,
        block,
        blockLog.executionOrder
      )
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
      cleanupSelfReference = this.preparePauseResumeSelfReference(
        blockCtx,
        node,
        block,
        nodeMetadata
      )
    }

    try {
      if (!isSentinel && blockType) {
        await validateBlockType(blockCtx.userId, blockCtx.workspaceId, blockType, blockCtx)
      }

      if (block.metadata?.id === BlockType.FUNCTION) {
        const {
          resolvedInputs: fnInputs,
          displayInputs,
          contextVariables,
        } = await this.resolver.resolveInputsForFunctionBlock(
          blockCtx,
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
        resolvedInputs = await this.resolver.resolveInputs(
          blockCtx,
          node.id,
          block.config.params,
          block
        )
        inputsForLog = resolvedInputs
      }

      if (blockLog) {
        blockLog.input = this.projectInputsForDisplay(inputsForLog, block, inputDisplayRegistry)
      }
    } catch (error) {
      cleanupSelfReference?.()
      try {
        return await this.handleBlockError(
          error,
          blockCtx,
          node,
          block,
          blockStartPromise,
          startTime,
          blockLog,
          inputsForLog,
          inputDisplayRegistry,
          isSentinel,
          'input_resolution'
        )
      } finally {
        commitBlockRegistry()
      }
    }
    cleanupSelfReference?.()

    let failureDiagnosticOutput: Record<string, any> | undefined
    try {
      /**
       * Only the handler call is retried. A streaming handler returns before any
       * token is drained, so a replay cannot duplicate output the client has
       * already seen.
       */
      const output = await this.runHandlerWithRetry(blockCtx, block, blockLog, () =>
        handler.executeWithNode
          ? handler.executeWithNode(blockCtx, block, resolvedInputs, nodeMetadata)
          : handler.execute(blockCtx, block, resolvedInputs, nodeMetadata)
      )

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
            blockCtx,
            node,
            block,
            streamingExec,
            resolvedInputs,
            normalizeStringArray(blockCtx.selectedOutputs)
          )
        } catch (streamError) {
          const resultRegistry = blockCtx.resolvedSecretTraceRegistry
          const diagnosticRegistry = streamingExec.diagnosticResolvedSecretTraceRegistry
          const errorRegistry = diagnosticRegistry
            ? diagnosticRegistry.forkForToolCall()
            : resultRegistry?.forkForToolCall()
          if (errorRegistry && resultRegistry && resultRegistry !== diagnosticRegistry) {
            errorRegistry.mergeToolCallRegistry(resultRegistry)
          }
          blockCtx.errorResolvedSecretTraceRegistry = errorRegistry
          blockCtx.resolvedSecretTraceRegistry = resultRegistry?.forkForPropagatedEntries()
          // Timeout / drain failures may still have projected answer text — keep it
          // for the failed block output so logs match what the client already saw.
          failureDiagnosticOutput = streamingExec.execution?.output
          throw streamError
        }

        normalizedOutput = this.normalizeOutput(
          streamingExec.execution.output ?? streamingExec.execution
        )
      } else {
        normalizedOutput = this.normalizeOutput(output)
      }

      if (blockCtx.includeFileBase64 === true && containsUserFileWithMetadata(normalizedOutput)) {
        normalizedOutput = (await hydrateUserFilesWithBase64(normalizedOutput, {
          requestId: blockCtx.metadata.requestId,
          workspaceId: blockCtx.workspaceId,
          workflowId: blockCtx.workflowId,
          executionId: blockCtx.executionId,
          largeValueExecutionIds: blockCtx.largeValueExecutionIds,
          largeValueKeys: blockCtx.largeValueKeys,
          fileKeys: blockCtx.fileKeys,
          allowLargeValueWorkflowScope: blockCtx.allowLargeValueWorkflowScope,
          userId: blockCtx.userId,
          maxBytes: blockCtx.base64MaxBytes,
          preserveLargeValueMetadata: true,
        })) as NormalizedBlockOutput
      }

      if (blockCtx.piiBlockOutputRedaction?.enabled) {
        // In-flight redaction before the log/state split below, so both the
        // downstream state copy and the persisted log copy are masked.
        // `onFailure: 'throw'` aborts the run rather than feeding corrupted/leaked
        // data downstream.
        const redactionOptions = {
          entityTypes: blockCtx.piiBlockOutputRedaction.entityTypes,
          language: blockCtx.piiBlockOutputRedaction.language,
          customPatterns: blockCtx.piiBlockOutputRedaction.customPatterns,
          onFailure: 'throw' as const,
        }
        // Tools like the function executor offload large outputs to large-value
        // refs BEFORE they reach here, and the string walk treats a ref as opaque.
        // So hydrate → mask → re-store any refs first, then mask inline strings —
        // otherwise PII inside an offloaded output is never redacted.
        normalizedOutput = await redactLargeValueRefsInValue(normalizedOutput, {
          ...redactionOptions,
          store: {
            workspaceId: blockCtx.workspaceId,
            workflowId: blockCtx.workflowId,
            executionId: blockCtx.executionId,
            userId: blockCtx.userId,
          },
        })
        normalizedOutput = await redactObjectStrings(normalizedOutput, redactionOptions)
      }

      normalizedOutput = (await compactExecutionPayload(normalizedOutput, {
        workspaceId: blockCtx.workspaceId,
        workflowId: blockCtx.workflowId,
        executionId: blockCtx.executionId,
        userId: blockCtx.userId,
        preserveUserFileBase64: blockCtx.includeFileBase64 === true,
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
        const childExecutionId = normalizedOutput[CHILD_EXECUTION_ID_OUTPUT_KEY]
        if (typeof childExecutionId === 'string' && childExecutionId) {
          blockLog.childExecution = { executionId: childExecutionId }
        }
        if (normalizedOutput[CHILD_TRACE_DISABLED_OUTPUT_KEY] === true) {
          blockLog.childTraceDisabled = true
        }
      }

      const {
        childTraceSpans: _traces,
        [CHILD_EXECUTION_ID_OUTPUT_KEY]: _childExecutionId,
        [CHILD_TRACE_DISABLED_OUTPUT_KEY]: _childTraceDisabled,
        ...outputForState
      } = normalizedOutput
      const stateOutput = outputForState as NormalizedBlockOutput
      const settledBlockRegistry = blockCtx.resolvedSecretTraceRegistry
      const stateProvenance = settledBlockRegistry?.exportCommittedProvenanceForValue(stateOutput)
      this.setNodeOutput(node, stateOutput, duration, stateProvenance)

      if (!isSentinel && blockLog) {
        const childWorkflowInstanceId =
          typeof normalizedOutput._childWorkflowInstanceId === 'string'
            ? normalizedOutput._childWorkflowInstanceId
            : undefined
        const displayOutput = filterOutputForLog(block.metadata?.id || '', normalizedOutput, {
          block,
        })
        const displayInput = this.projectInputsForDisplay(inputsForLog, block, inputDisplayRegistry)
        blockLog.input = displayInput
        const displayProvenance = settledBlockRegistry?.exportCommittedProvenanceForValue({
          input: displayInput,
          output: displayOutput,
        })
        this.setBlockLogDisplayProvenance(blockLog, displayProvenance)
        this.fireBlockCompleteCallback(
          blockStartPromise,
          blockCtx,
          node,
          block,
          displayInput,
          displayOutput,
          duration,
          blockLog.startedAt,
          blockLog.executionOrder,
          blockLog.endedAt,
          childWorkflowInstanceId,
          stateProvenance,
          displayProvenance
        )
      }

      commitBlockRegistry()
      return stateOutput
    } catch (error) {
      if (!failureDiagnosticOutput && error instanceof StructuredOutputTokenLimitError) {
        failureDiagnosticOutput = error.diagnosticOutput
      }
      try {
        return await this.handleBlockError(
          error,
          blockCtx,
          node,
          block,
          blockStartPromise,
          startTime,
          blockLog,
          inputsForLog,
          inputDisplayRegistry,
          isSentinel,
          'execution',
          failureDiagnosticOutput
        )
      } finally {
        commitBlockRegistry()
      }
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

  private setNodeOutput(
    node: DAGNode,
    output: NormalizedBlockOutput,
    duration = 0,
    resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  ): void {
    this.state.setBlockOutput(node.id, output, duration, resolvedSecretTraceProvenance)

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
        this.state.setBlockOutput(
          globalBranchNodeId,
          output,
          duration,
          resolvedSecretTraceProvenance
        )
      }
      this.state.setBlockOutput(
        buildOuterBranchScopedId(originalBlockId, branchIndex),
        output,
        duration,
        resolvedSecretTraceProvenance
      )
    }
  }

  private setBlockLogDisplayProvenance(
    blockLog: BlockLog,
    provenance: ResolvedSecretTraceProvenanceV1 | undefined
  ): void {
    if (!provenance) return
    Object.defineProperty(blockLog, 'displayResolvedSecretTraceProvenance', {
      value: provenance,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  private findHandler(block: SerializedBlock): BlockHandler | undefined {
    return this.blockHandlers.find((h) => h.canHandle(block))
  }

  /**
   * Runs the block handler, replaying it on failure while tries remain.
   *
   * Rethrows the final try's error so the caller's catch — and with it the error
   * port — behaves exactly as it does for a block that never retried. Retrying
   * only ever delays the existing outcome; it never changes it.
   */
  private async runHandlerWithRetry<T>(
    ctx: ExecutionContext,
    block: SerializedBlock,
    blockLog: BlockLog | undefined,
    invoke: () => Promise<T>
  ): Promise<T> {
    const policy = resolveBlockRetryPolicy(block)
    if (!policy) return invoke()

    let tries = 0
    try {
      for (;;) {
        tries++
        try {
          return await invoke()
        } catch (error) {
          const isFinalTry = tries >= policy.maxTries
          if (isFinalTry || ctx.abortSignal?.aborted || !isRetryableBlockError(error)) throw error

          this.execLogger.warn('Block failed; retrying', {
            blockId: block.id,
            blockType: block.metadata?.id,
            tries,
            maxTries: policy.maxTries,
            waitBetweenTriesMs: policy.waitBetweenTriesMs,
            error: normalizeError(error),
          })

          if (policy.waitBetweenTriesMs > 0) await sleep(policy.waitBetweenTriesMs)

          /** `sleep` is not abort-aware, so a run stopped mid-wait must not start another try. */
          if (ctx.abortSignal?.aborted) throw error
        }
      }
    } finally {
      if (blockLog && tries > 1) blockLog.tries = tries
    }
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
    inputDisplayRegistry: ResolvedSecretTraceRegistry | undefined,
    isSentinel: boolean,
    phase: 'input_resolution' | 'execution',
    failureDiagnosticOutput?: Record<string, any>
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
    const isTimeout = isTimeoutAbortReason(ctx.abortSignal?.reason)
    const isAgentBlock = block.metadata?.id === BlockType.AGENT
    if (isAbort && !isTimeout && ctx.abortSignal?.aborted && isAgentBlock) {
      const softOutput: NormalizedBlockOutput = {
        content: '',
      }
      const softOutputProvenance =
        ctx.resolvedSecretTraceRegistry?.exportCommittedProvenanceForValue(softOutput)

      this.setNodeOutput(node, softOutput, duration, softOutputProvenance)

      if (blockLog) {
        blockLog.endedAt = endedAt
        blockLog.durationMs = duration
        blockLog.success = true
        blockLog.error = undefined
        blockLog.input = this.projectInputsForDisplay(input, block, inputDisplayRegistry)
        blockLog.output = filterOutputForLog(block.metadata?.id || '', softOutput, { block })
      }

      this.execLogger.info('Block stream aborted by client; soft-completing', {
        blockId: node.id,
        blockType: block.metadata?.id,
      })

      if (!isSentinel && blockLog) {
        const displayInput = this.projectInputsForDisplay(input, block, inputDisplayRegistry)
        const displayOutput = filterOutputForLog(block.metadata?.id || '', softOutput, { block })
        const displayProvenance =
          ctx.resolvedSecretTraceRegistry?.exportCommittedProvenanceForValue({
            input: displayInput,
            output: displayOutput,
          })
        this.setBlockLogDisplayProvenance(blockLog, displayProvenance)
        this.fireBlockCompleteCallback(
          blockStartPromise,
          ctx,
          node,
          block,
          displayInput,
          displayOutput,
          duration,
          blockLog.startedAt,
          blockLog.executionOrder,
          blockLog.endedAt,
          undefined,
          softOutputProvenance,
          displayProvenance
        )
      }

      return softOutput
    }

    const errorOutput: NormalizedBlockOutput = {
      error: errorMessage,
    }

    // Retain completed provider diagnostics for observability and billing while
    // keeping the block failed so normal downstream execution cannot consume it.
    let providerDiagnostics: Record<string, unknown> = {}
    for (const key of ['content', 'model', 'tokens', 'toolCalls', 'providerTiming', 'cost']) {
      const value = failureDiagnosticOutput?.[key]
      if (value !== undefined) {
        providerDiagnostics[key] = value
      }
    }
    if (ctx.piiBlockOutputRedaction?.enabled && Object.keys(providerDiagnostics).length > 0) {
      stripThinkingContentFromOutput(providerDiagnostics)
      providerDiagnostics = await redactObjectStrings(providerDiagnostics, {
        entityTypes: ctx.piiBlockOutputRedaction.entityTypes,
        language: ctx.piiBlockOutputRedaction.language,
        customPatterns: ctx.piiBlockOutputRedaction.customPatterns,
        onFailure: 'scrub',
      })
    }
    Object.assign(errorOutput, providerDiagnostics)

    // Only real workflow blocks surface a child workflow name. A custom block's
    // source workflow is never named to its consumer — and before the handler
    // resolves the real name this field still holds the source workflow id, so
    // an early throw (e.g. the call-chain depth limit) would leak it outright.
    if (ChildWorkflowError.isChildWorkflowError(error)) {
      if (isWorkflowBlockType(block.metadata?.id)) {
        errorOutput.childWorkflowName = error.childWorkflowName
        if (error.childWorkflowSnapshotId) {
          errorOutput.childWorkflowSnapshotId = error.childWorkflowSnapshotId
        }
      }
      // A custom block's consumer gets a machine-readable failure class and an
      // opaque handle to the failed run — enough to branch on and to quote in a
      // support request, without naming anything inside the source workflow.
      if (error.consumerFacing) {
        errorOutput.errorType = error.consumerFacing.errorType
        if (error.consumerFacing.ref) {
          errorOutput.errorRef = error.consumerFacing.ref
        }
      }
    }

    const errorRegistry = ctx.errorResolvedSecretTraceRegistry ?? ctx.resolvedSecretTraceRegistry
    const errorOutputProvenance = errorRegistry?.exportCommittedProvenanceForValue(errorOutput)
    this.setNodeOutput(node, errorOutput, duration, errorOutputProvenance)

    if (blockLog) {
      blockLog.endedAt = endedAt
      blockLog.durationMs = duration
      blockLog.success = false
      blockLog.error = errorMessage
      blockLog.input = this.projectInputsForDisplay(input, block, inputDisplayRegistry)
      blockLog.output = filterOutputForLog(block.metadata?.id || '', errorOutput, { block })

      if (ChildWorkflowError.isChildWorkflowError(error) && error.childTraceSpans.length > 0) {
        blockLog.childTraceSpans = error.childTraceSpans
      }
      // A failed custom block still has its own child run to join at read time —
      // unless the instance opted out, which leaves only the marker.
      if (ChildWorkflowError.isChildWorkflowError(error) && error.childExecutionId) {
        blockLog.childExecution = { executionId: error.childExecutionId }
      }
      if (ChildWorkflowError.isChildWorkflowError(error) && error.childTraceDisabled) {
        blockLog.childTraceDisabled = true
      }
    }

    const diagnosticRegistry = ctx.errorResolvedSecretTraceRegistry
      ? ctx.errorResolvedSecretTraceRegistry
      : inputDisplayRegistry?.forkForToolCall()
    if (
      !ctx.errorResolvedSecretTraceRegistry &&
      diagnosticRegistry &&
      ctx.resolvedSecretTraceRegistry &&
      ctx.resolvedSecretTraceRegistry !== inputDisplayRegistry
    ) {
      diagnosticRegistry.mergeToolCallRegistry(ctx.resolvedSecretTraceRegistry)
    }
    const errorDiagnostic = projectResolvedSecretDiagnosticError(
      error,
      diagnosticRegistry ?? ctx.resolvedSecretTraceRegistry
    )

    this.execLogger.error(
      phase === 'input_resolution' ? 'Failed to resolve block inputs' : 'Block execution failed',
      {
        blockId: node.id,
        blockType: block.metadata?.id,
        ...errorDiagnostic,
      }
    )

    if (!isSentinel && blockLog) {
      const childWorkflowInstanceId = ChildWorkflowError.isChildWorkflowError(error)
        ? error.childWorkflowInstanceId
        : undefined
      const displayOutput = filterOutputForLog(block.metadata?.id || '', errorOutput, { block })
      const displayInput = this.projectInputsForDisplay(input, block, inputDisplayRegistry)
      const displayProvenance = errorRegistry?.exportCommittedProvenanceForValue({
        input: displayInput,
        output: displayOutput,
      })
      this.setBlockLogDisplayProvenance(blockLog, displayProvenance)
      this.fireBlockCompleteCallback(
        blockStartPromise,
        ctx,
        node,
        block,
        displayInput,
        displayOutput,
        duration,
        blockLog.startedAt,
        blockLog.executionOrder,
        blockLog.endedAt,
        childWorkflowInstanceId,
        errorOutputProvenance,
        displayProvenance
      )
    }

    const hasErrorPort = this.hasErrorPortEdge(node)
    if (hasErrorPort) {
      if (blockLog) {
        blockLog.errorHandled = true
      }
      this.execLogger.info('Block has error port - returning error output instead of throwing', {
        blockId: node.id,
        ...errorDiagnostic,
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

  /** Builds the log-facing input copy from resolver-recorded projections only. */
  private projectInputsForDisplay(
    inputs: Record<string, any>,
    block: SerializedBlock | undefined,
    registry: ResolvedSecretTraceRegistry | undefined
  ): Record<string, any> {
    const projection = registry?.projectResolvedInputSelection(inputs)
    if (projection && !projection.complete) return {}
    return this.sanitizeInputsForLog(projection?.value ?? inputs, block)
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
    block?: SerializedBlock
  ): Record<string, any> {
    const blockType = block?.metadata?.id
    const privateInputIds = new Set(block?.privateInputIds ?? [])
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
      inputs = isRecordLike(parsed) ? parsed : {}
    }

    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(inputs)) {
      if (
        SYSTEM_SUBBLOCK_IDS.includes(key) ||
        key === 'triggerMode' ||
        key === FUNCTION_BLOCK_CONTEXT_VARS_KEY ||
        key === FUNCTION_BLOCK_DISPLAY_CODE_KEY ||
        privateInputIds.has(key)
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
          ...projectResolvedSecretDiagnosticError(error, ctx.resolvedSecretTraceRegistry),
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
    childWorkflowInstanceId?: string,
    resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1,
    displayResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
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
          ...(resolvedSecretTraceProvenance ? { resolvedSecretTraceProvenance } : {}),
          ...(displayResolvedSecretTraceProvenance ? { displayResolvedSecretTraceProvenance } : {}),
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
        ...projectResolvedSecretDiagnosticError(error, ctx.resolvedSecretTraceRegistry),
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
    const projectStreamDiagnosticError = (error: unknown): Record<string, unknown> => {
      const sourceRegistry = streamingExec.diagnosticResolvedSecretTraceRegistry
      const resultRegistry = ctx.resolvedSecretTraceRegistry
      if (!sourceRegistry || sourceRegistry === resultRegistry) {
        return projectResolvedSecretDiagnosticError(error, resultRegistry)
      }
      const diagnosticRegistry = sourceRegistry.forkForToolCall()
      if (resultRegistry) diagnosticRegistry.mergeToolCallRegistry(resultRegistry)
      return projectResolvedSecretDiagnosticError(error, diagnosticRegistry)
    }

    const responseFormat =
      resolvedInputs?.responseFormat ??
      (block.config?.params as Record<string, any> | undefined)?.responseFormat ??
      (block.config as Record<string, any> | undefined)?.responseFormat
    const parsedResponseFormat = parseResponseFormat(responseFormat)

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
      const {
        diagnosticResolvedSecretTraceRegistry: _diagnosticRegistry,
        ...streamingExecutionForConsumer
      } = streamingExec
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
          ...streamingExecutionForConsumer,
          stream: processedClientStream,
          streamFormat: 'text',
          subscribe: pump.subscribe,
          // processStream returns the input stream identity when no
          // response-format extraction applies.
          clientStreamTransformed: processedClientStream !== pump.textStream,
          displayResolvedSecretTraceProvenance:
            ctx.resolvedSecretTraceRegistry?.exportCommittedProvenanceForValue(resolvedInputs),
        })
        .catch(async (error) => {
          this.execLogger.error('Error in onStream callback', {
            blockId,
            ...projectStreamDiagnosticError(error),
          })
          await processedClientStream?.cancel().catch(() => {})
        })
    }

    let pumpResult
    try {
      pumpResult = await pump.run()
    } catch (error) {
      this.execLogger.error('Error reading stream for block', {
        blockId,
        ...projectStreamDiagnosticError(error),
      })
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

    if (fullContent && piiEnabled && ctx.piiBlockOutputRedaction) {
      // Mask before writing to `execution.output` or `onFullContent`.
      fullContent = await redactObjectStrings(fullContent, {
        entityTypes: ctx.piiBlockOutputRedaction.entityTypes,
        language: ctx.piiBlockOutputRedaction.language,
        customPatterns: ctx.piiBlockOutputRedaction.customPatterns,
        onFailure: 'throw',
      })
    }

    const executionOutput = streamingExec.execution?.output
    if (pumpResult.finishReason && executionOutput?.providerTiming?.timeSegments) {
      enrichLastModelSegment(executionOutput.providerTiming.timeSegments, {
        finishReason: pumpResult.finishReason,
      })
    }
    if (executionOutput && typeof executionOutput === 'object' && parsedResponseFormat) {
      // Retain even empty content for failed-block diagnostics, but reject it
      // before parsing so token-limited structured data never reaches downstream.
      executionOutput.content = fullContent
      assertStructuredOutputNotTokenLimited(executionOutput.providerTiming, executionOutput)
    }

    if (!fullContent) {
      return
    }

    if (executionOutput && typeof executionOutput === 'object') {
      let parsedForFormat = false
      if (responseFormat) {
        // Retain the drained text for failed-block diagnostics, but reject it
        // before parsing so truncated structured data never reaches downstream.
        executionOutput.content = fullContent
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
            ...projectStreamDiagnosticError(error),
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
        this.execLogger.error('onFullContent callback failed', {
          blockId,
          ...projectStreamDiagnosticError(error),
        })
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
