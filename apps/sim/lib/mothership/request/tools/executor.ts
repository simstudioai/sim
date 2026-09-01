import {
  BROWSER_WAIT_FOR_RENDERER_GRACE_MS,
  normalizeBrowserWaitForTimeoutMs,
} from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type {
  AsyncCompletionEnvelope,
  AsyncCompletionSignal,
} from '@/lib/mothership/async-runs/lifecycle'
import {
  completeAsyncToolCall,
  markAsyncToolRunning,
  upsertAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import { TOOL_WATCHDOG_DEFAULT_MS, TOOL_WATCHDOG_LONG_RUNNING_MS } from '@/lib/mothership/constants'
import {
  MothershipStreamV1AsyncToolRecordStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import {
  ApplyFileEdit,
  CreateEmptyFile,
  CreateWorkflow,
  DeployAsApi,
  DeployAsChat,
  DeployAsMcp,
  DownloadFile,
  Ffmpeg,
  GenerateApiKey,
  GenerateAudio,
  GenerateImage,
  GenerateVideo,
  LoadDeployment,
  ManageKnowledgeBase,
  Media,
  PrepareFileEdit,
  PromoteToLive,
  PublishCustomBlock,
  Redeploy,
  Run,
  RunBlock,
  RunCode,
  RunFromBlock,
  RunFunction,
  RunWorkflow,
  RunWorkflowUntilBlock,
  SaveUpload,
  Search,
  WebCrawl,
} from '@/lib/mothership/generated/tool-catalog-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { publishToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import { recordSimToolMetric } from '@/lib/mothership/request/metrics'
import { withCopilotToolSpan } from '@/lib/mothership/request/otel'
import { markToolResultSeen } from '@/lib/mothership/request/sse-utils'
import {
  getToolCallTerminalData,
  requireToolCallError,
  setTerminalToolCallState,
} from '@/lib/mothership/request/tool-call-state'
import { maybeWriteOutputToFile } from '@/lib/mothership/request/tools/files'
import {
  describeWithholdingCause,
  inspectToolResultForCopilot,
} from '@/lib/mothership/request/tools/resolved-secret-result'
import { handleResourceSideEffects } from '@/lib/mothership/request/tools/resources'
import {
  maybeWriteOutputToTable,
  maybeWriteReadCsvToTable,
} from '@/lib/mothership/request/tools/tables'
import { applyCreateWorkflowOutputToContext } from '@/lib/mothership/request/tools/workflow-context'
import {
  type ExecutionContext,
  isTerminalToolCallStatus,
  type OrchestratorOptions,
  type StreamEvent,
  type StreamingContext,
  type ToolCallState,
} from '@/lib/mothership/request/types'
import { ensureHandlersRegistered, executeTool } from '@/lib/mothership/tool-executor'
import { isMcpTool } from '@/executor/constants'

export { waitForToolCompletion } from '@/lib/mothership/request/tools/client'

const logger = createLogger('CopilotSseToolExecution')

function hasOutputValue(result: { output?: unknown } | undefined): result is { output: unknown } {
  return result !== undefined && Object.hasOwn(result, 'output')
}

interface ToolResultSpanSummary {
  resultSuccess: boolean
  outputBytes: number
  outputKind: string
  errorMessage?: string
  imageCount?: number
  imageBytes?: number
  attachmentMediaType?: string
}

function summarizeToolResultForSpan(result: {
  success: boolean
  output?: unknown
  error?: string
}): ToolResultSpanSummary {
  const summary: ToolResultSpanSummary = {
    resultSuccess: Boolean(result.success),
    outputBytes: 0,
    outputKind: 'none',
  }
  if (!result.success && result.error) {
    summary.errorMessage = String(result.error).slice(0, 500)
  }
  if (!hasOutputValue(result)) {
    return summary
  }
  const output = (result as { output: unknown }).output
  if (typeof output === 'string') {
    summary.outputKind = 'string'
    summary.outputBytes = output.length
  } else if (output && typeof output === 'object') {
    summary.outputKind = Array.isArray(output) ? 'array' : 'object'
    try {
      summary.outputBytes = JSON.stringify(output).length
    } catch {
      summary.outputBytes = 0
    }
    const attachment = extractAttachmentShape(output)
    if (attachment) {
      summary.imageCount = attachment.imageCount
      summary.imageBytes = attachment.imageBytes
      if (attachment.mediaType) {
        summary.attachmentMediaType = attachment.mediaType
      }
    }
  } else if (output !== undefined && output !== null) {
    summary.outputKind = typeof output
    summary.outputBytes = String(output).length
  }
  return summary
}

function extractAttachmentShape(
  output: unknown
): { imageCount: number; imageBytes: number; mediaType?: string } | null {
  if (!isRecordLike(output)) return null
  const candidate = (output as Record<string, unknown>).attachment
  if (!isRecordLike(candidate)) return null
  const source = (candidate as Record<string, unknown>).source
  if (!isRecordLike(source)) return null
  const type =
    typeof (candidate as Record<string, unknown>).type === 'string'
      ? ((candidate as Record<string, unknown>).type as string)
      : ''
  if (type !== 'image') return null
  const mediaType =
    typeof source.media_type === 'string' ? (source.media_type as string) : undefined
  const data = typeof source.data === 'string' ? (source.data as string) : ''
  return {
    imageCount: 1,
    imageBytes: data.length,
    mediaType,
  }
}

function buildCompletionSignal(input: {
  status: AsyncCompletionSignal['status']
  message?: string
  data?: unknown
}): AsyncCompletionSignal {
  return {
    status: input.status,
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
  }
}

export interface AsyncToolCompletion extends AsyncCompletionSignal {}

function publishTerminalToolConfirmation(input: {
  toolCallId: string
  status: AsyncCompletionEnvelope['status']
  message?: string
  data?: unknown
}): void {
  publishToolConfirmation({
    toolCallId: input.toolCallId,
    status: input.status,
    message: input.message,
    data: input.data,
    timestamp: new Date().toISOString(),
  })
}

function abortRequested(
  context: StreamingContext,
  execContext: ExecutionContext,
  options?: OrchestratorOptions
): boolean {
  return Boolean(
    options?.abortSignal?.aborted || execContext.abortSignal?.aborted || context.wasAborted
  )
}

/**
 * Tool classes whose legitimate runtime can far exceed the default watchdog:
 * workflow executions, sandboxed code, media/image/audio generation, deep
 * research, large downloads, knowledge-base indexing, and file-content
 * producers (create/edit/materialize hit the E2B doc compile/recalc/render
 * pipeline on doc-backed files). They get the long watchdog cap; everything
 * else (read/glob/grep/metadata CRUD/...) must settle within the strict
 * default or be failed so the run can continue.
 */
const LONG_RUNNING_TOOL_IDS: ReadonlySet<string> = new Set([
  Run.id,
  RunBlock.id,
  RunFromBlock.id,
  RunWorkflow.id,
  RunWorkflowUntilBlock.id,
  RunFunction.id,
  RunCode.id,
  GenerateImage.id,
  GenerateAudio.id,
  GenerateVideo.id,
  Ffmpeg.id,
  Media.id,
  Search.id,
  WebCrawl.id,
  ManageKnowledgeBase.id,
  DownloadFile.id,
  CreateEmptyFile.id,
  ApplyFileEdit.id,
  SaveUpload.id,
  PrepareFileEdit.id,
  DeployAsApi.id,
  DeployAsChat.id,
  PublishCustomBlock.id,
  DeployAsMcp.id,
  Redeploy.id,
  LoadDeployment.id,
  PromoteToLive.id,
])

export function toolWatchdogTimeoutMs(toolName: string | undefined): number {
  return toolName && (LONG_RUNNING_TOOL_IDS.has(toolName) || isMcpTool(toolName))
    ? TOOL_WATCHDOG_LONG_RUNNING_MS
    : TOOL_WATCHDOG_DEFAULT_MS
}

/**
 * How long the resume gate may wait on one pending tool call. Permission
 * prompts receive the long-running budget, while `browser_wait_for` receives
 * its normalized requested timeout plus renderer delivery grace.
 */
export function pendingToolWaitBudgetMs(
  toolCall:
    | (Pick<ToolCallState, 'name' | 'status'> & Partial<Pick<ToolCallState, 'params'>>)
    | undefined
): number {
  if (toolCall?.status === 'awaiting_approval') return TOOL_WATCHDOG_LONG_RUNNING_MS
  if (toolCall?.name === 'browser_wait_for') {
    return (
      normalizeBrowserWaitForTimeoutMs(toolCall.params?.timeoutMs) +
      BROWSER_WAIT_FOR_RENDERER_GRACE_MS
    )
  }
  return toolWatchdogTimeoutMs(toolCall?.name)
}

/**
 * Bare timeout/abort messages (AbortSignal.timeout's "The operation timed out.",
 * a DOMException's "This operation was aborted") strip everything the model
 * needs to reason about the failure. Name the tool, the elapsed time, and the
 * honest uncertainty; leave every informative message untouched.
 */
export function enrichOpaqueToolError(
  message: string,
  toolName: string,
  startTimeMs: number | undefined
): string {
  if (
    !/^(the operation timed out\.?|this operation was aborted\.?|timeout|aborted)$/i.test(
      message.trim()
    )
  ) {
    return message
  }
  const elapsed = startTimeMs ? ` after ~${Math.round((Date.now() - startTimeMs) / 1000)}s` : ''
  return (
    `${toolName} timed out${elapsed} inside its handler ("${message}"). ` +
    'The operation may or may not have landed — read the affected resource back before ' +
    'retrying, and prefer a narrower invocation if this was a heavy call.'
  )
}

class ToolExecutionTimeoutError extends Error {
  constructor(toolName: string, timeoutMs: number) {
    super(
      `Tool '${toolName}' timed out after ${Math.round(timeoutMs / 1000)}s on the Sim executor and was abandoned.`
    )
    this.name = 'ToolExecutionTimeoutError'
  }
}

/** Builds the per-call context from the turn-scoped execution context. */
export function buildToolExecutionContext(
  toolCall: Pick<ToolCallState, 'id' | 'parentToolCallId' | 'params'>,
  execContext: ExecutionContext
): ExecutionContext {
  return {
    ...execContext,
    toolCallId: toolCall.id,
    resolvedSecretTraceRegistry: execContext.resolvedSecretTraceRegistry?.forkForInputPaths([]),
    ...(toolCall.parentToolCallId ? { parentToolCallId: toolCall.parentToolCallId } : {}),
  }
}

/**
 * Execute a tool with a hard settlement guarantee. If the handler neither
 * resolves nor rejects within the tool's watchdog cap, throw a timeout error
 * so the standard failure path (persist failed row, publish terminal
 * confirmation, resume Go with an error result) runs and the chat never
 * wedges behind a hung await. The losing promise keeps running detached; its
 * eventual settlement is ignored.
 */
async function executeToolWithWatchdog(toolCall: ToolCallState, toolContext: ExecutionContext) {
  // The frame's wire name can be a display identity (the worker's cli_* names);
  // execution always dispatches on the model's real tool name.
  const executableName = toolCall.execName ?? toolCall.name
  const timeoutMs = toolWatchdogTimeoutMs(executableName)
  const execution = executeTool(executableName, toolCall.params || {}, toolContext)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      execution,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ToolExecutionTimeoutError(toolCall.name, timeoutMs)),
          timeoutMs
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    // Swallow the abandoned promise's eventual rejection so it can't surface
    // as an unhandled rejection after a watchdog loss.
    execution.catch(() => {})
  }
}

/**
 * Last-resort settlement for a tool whose promise never settled (a hang the
 * per-tool watchdog could not see, e.g. in post-processing or persistence).
 * Records a terminal error state + failed async row so the checkpoint loop
 * can resume Go with an error result instead of waiting forever.
 */
export async function forceFailHungToolCall(
  toolCallId: string,
  context: StreamingContext,
  message: string
): Promise<void> {
  const toolCall = context.toolCalls.get(toolCallId)
  if (!toolCall || toolCall.endTime || isTerminalToolCallStatus(toolCall.status)) return
  setTerminalToolCallState(toolCall, {
    status: MothershipStreamV1ToolOutcome.error,
    error: message,
  })
  logger.error('Force-failed hung tool call', {
    toolCallId,
    toolName: toolCall.name,
    message,
  })
  markToolResultSeen(context, toolCallId)
  await completeAsyncToolCall({
    toolCallId,
    status: MothershipStreamV1AsyncToolRecordStatus.failed,
    result: { error: message },
    error: message,
  }).catch((err) => {
    logger.warn('Failed to persist force-failed async tool status', {
      toolCallId,
      error: toError(err).message,
    })
  })
  publishTerminalToolConfirmation({
    toolCallId,
    status: MothershipStreamV1ToolOutcome.error,
    message,
    data: { error: message },
  })
}

function cancelledCompletion(message: string): AsyncToolCompletion {
  return buildCompletionSignal({
    status: MothershipStreamV1ToolOutcome.cancelled,
    message,
    data: { cancelled: true },
  })
}

function terminalCompletionFromToolCall(toolCall: ToolCallState): AsyncToolCompletion {
  if (toolCall.status === MothershipStreamV1ToolOutcome.cancelled) {
    return cancelledCompletion(requireToolCallError(toolCall))
  }

  if (toolCall.status === MothershipStreamV1ToolOutcome.success) {
    // getToolCallTerminalData (not raw output) so the completion signal carries
    // the model-facing/redacted result — keeps the sim_key out of every path
    // that consumes a completion, matching the error branch below.
    const data = getToolCallTerminalData(toolCall)
    return buildCompletionSignal({
      status: MothershipStreamV1ToolOutcome.success,
      message: 'Tool completed',
      ...(data !== undefined ? { data } : {}),
    })
  }

  if (toolCall.status === MothershipStreamV1ToolOutcome.skipped) {
    const data = getToolCallTerminalData(toolCall)
    return buildCompletionSignal({
      status: MothershipStreamV1ToolOutcome.success,
      message: 'Tool skipped',
      ...(data !== undefined ? { data } : {}),
    })
  }

  const terminalErrorMessage = requireToolCallError(toolCall)
  return buildCompletionSignal({
    status: MothershipStreamV1ToolOutcome.error,
    message: terminalErrorMessage,
    data: getToolCallTerminalData(toolCall),
  })
}

export async function executeToolAndReport(
  toolCallId: string,
  context: StreamingContext,
  execContext: ExecutionContext,
  options?: OrchestratorOptions
): Promise<AsyncToolCompletion> {
  const toolCall = context.toolCalls.get(toolCallId)
  if (!toolCall)
    return buildCompletionSignal({
      status: MothershipStreamV1ToolOutcome.error,
      message: 'Tool call not found',
    })

  const argsPayload = toolCall.params
    ? (() => {
        try {
          return JSON.stringify(toolCall.params)
        } catch {
          return undefined
        }
      })()
    : undefined
  return withCopilotToolSpan(
    {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      agentName: toolCall.agentId ?? 'main',
      runId: context.runId,
      chatId: execContext.chatId,
      argsBytes: argsPayload?.length,
      argsPreview: argsPayload?.slice(0, 200),
    },
    async (otelSpan) => {
      const startedAt = Date.now()
      try {
        const completion = await executeToolAndReportInner(toolCall, context, execContext, options)
        const durationMs = Date.now() - startedAt
        otelSpan.setAttribute(TraceAttr.ToolOutcome, completion.status)
        otelSpan.setAttribute(TraceAttr.ToolDurationMs, durationMs)
        if (completion.message) {
          otelSpan.setAttribute(
            TraceAttr.ToolOutcomeMessage,
            String(completion.message).slice(0, 500)
          )
        }
        // Durable Grafana signal for "which Sim tool is slowest" (executor=sim);
        // pairs with the Go executor-boundary metric (U15) as one series set.
        recordSimToolMetric(
          toolCall.name,
          toolCall.agentId ?? 'main',
          completion.status,
          durationMs
        )
        return completion
      } catch (err) {
        // executeToolAndReportInner threw (infra/unexpected error, not a normal
        // 'error' completion). Still stamp the span + record the dispatch so
        // copilot.tool.* isn't silently biased toward successful calls.
        const durationMs = Date.now() - startedAt
        otelSpan.setAttribute(TraceAttr.ToolOutcome, 'error')
        otelSpan.setAttribute(TraceAttr.ToolDurationMs, durationMs)
        recordSimToolMetric(
          toolCall.name,
          toolCall.agentId ?? 'main',
          MothershipStreamV1ToolOutcome.error,
          durationMs
        )
        throw err
      }
    }
  )
}

async function executeToolAndReportInner(
  toolCall: ToolCallState,
  context: StreamingContext,
  execContext: ExecutionContext,
  options?: OrchestratorOptions
): Promise<AsyncToolCompletion> {
  if (toolCall.status === 'executing') {
    return buildCompletionSignal({
      status: MothershipStreamV1AsyncToolRecordStatus.running,
      message: 'Tool already executing',
    })
  }
  if (toolCall.endTime || isTerminalToolCallStatus(toolCall.status)) {
    return terminalCompletionFromToolCall(toolCall)
  }

  const markToolCallCancelled = (message: string) => {
    setTerminalToolCallState(toolCall, {
      status: MothershipStreamV1ToolOutcome.cancelled,
      error: message,
    })
  }

  if (abortRequested(context, execContext, options)) {
    markToolCallCancelled('Request aborted before tool execution')
    markToolResultSeen(context, toolCall.id)
    await completeAsyncToolCall({
      toolCallId: toolCall.id,
      status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
      result: { cancelled: true },
      error: 'Request aborted before tool execution',
    }).catch((err) => {
      logger.warn('Failed to persist async tool status', {
        toolCallId: toolCall.id,
        error: toError(err).message,
      })
    })
    publishTerminalToolConfirmation({
      toolCallId: toolCall.id,
      status: MothershipStreamV1ToolOutcome.cancelled,
      message: 'Request aborted before tool execution',
      data: { cancelled: true },
    })
    return cancelledCompletion('Request aborted before tool execution')
  }

  toolCall.status = 'executing'
  await upsertAsyncToolCall({
    runId: context.runId,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.params,
  }).catch((err) => {
    logger.warn('Failed to persist async tool row before execution', {
      toolCallId: toolCall.id,
      error: toError(err).message,
    })
  })
  await markAsyncToolRunning(toolCall.id, 'sim-stream').catch((err) => {
    logger.warn('Failed to mark async tool running', {
      toolCallId: toolCall.id,
      error: toError(err).message,
    })
  })

  if (toolCall.endTime || isTerminalToolCallStatus(toolCall.status)) {
    return terminalCompletionFromToolCall(toolCall)
  }

  const argsPreview = toolCall.params ? JSON.stringify(toolCall.params).slice(0, 200) : undefined
  const toolSpan = context.trace.startSpan(toolCall.name, 'tool.execute', {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    argsPreview,
    abortSignalAborted: execContext.abortSignal?.aborted ?? false,
  })

  const endToolSpan = (
    status: string,
    detail?: { error?: string; cancelReason?: string; resultSuccess?: boolean }
  ) => {
    const abortDetail: Record<string, unknown> = {}
    if (execContext.abortSignal?.aborted) {
      abortDetail.abortSignalAborted = true
      abortDetail.abortReason = String(execContext.abortSignal.reason ?? 'unknown')
    }
    if (options?.abortSignal?.aborted) {
      abortDetail.optionsAbortReason = String(options.abortSignal.reason ?? 'unknown')
    }
    if (context.wasAborted) {
      abortDetail.wasAborted = true
    }
    toolSpan.attributes = { ...toolSpan.attributes, ...abortDetail, ...detail }
    context.trace.endSpan(toolSpan, status)
  }
  const endToolSpanFromTerminalState = () => {
    const terminalStatus =
      toolCall.status === MothershipStreamV1ToolOutcome.cancelled
        ? 'cancelled'
        : toolCall.status === MothershipStreamV1ToolOutcome.success ||
            toolCall.status === MothershipStreamV1ToolOutcome.skipped
          ? 'ok'
          : 'error'
    endToolSpan(terminalStatus, {
      resultSuccess: toolCall.status === MothershipStreamV1ToolOutcome.success,
      ...(toolCall.error ? { error: toolCall.error } : {}),
    })
  }

  logger.info('Tool execution started', {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  })

  const toolExecutionContext = buildToolExecutionContext(toolCall, execContext)
  let toolRegistryMerged = false
  const mergeToolRegistry = (projectionSafe: boolean) => {
    if (!projectionSafe || toolRegistryMerged) return
    const toolRegistry = toolExecutionContext.resolvedSecretTraceRegistry
    if (!toolRegistry?.isComplete()) return
    toolRegistryMerged = true
    const parentRegistry = execContext.resolvedSecretTraceRegistry
    if (parentRegistry && toolRegistry) parentRegistry.mergeToolCallRegistry(toolRegistry)
  }

  try {
    ensureHandlersRegistered()
    let result = await executeToolWithWatchdog(toolCall, toolExecutionContext)
    if (toolCall.endTime || isTerminalToolCallStatus(toolCall.status)) {
      endToolSpanFromTerminalState()
      return terminalCompletionFromToolCall(toolCall)
    }
    if (abortRequested(context, execContext, options)) {
      const copilotResult = inspectToolResultForCopilot(
        result,
        toolExecutionContext.resolvedSecretTraceRegistry,
        toolCall.name
      ).result
      markToolCallCancelled('Request aborted during tool execution')
      markToolResultSeen(context, toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
        result: { cancelled: true },
        error: 'Request aborted during tool execution',
      }).catch((err) => {
        logger.warn('Failed to persist async tool status', {
          toolCallId: toolCall.id,
          error: toError(err).message,
        })
      })
      publishTerminalToolConfirmation({
        toolCallId: toolCall.id,
        status: MothershipStreamV1ToolOutcome.cancelled,
        message: 'Request aborted during tool execution',
        data: { cancelled: true },
      })
      endToolSpan('cancelled', {
        cancelReason: 'abort_during_execution',
        error: copilotResult.success === false ? copilotResult.error : undefined,
      })
      return cancelledCompletion('Request aborted during tool execution')
    }
    result = await maybeWriteOutputToFile(
      toolCall.name,
      toolCall.params,
      result,
      toolExecutionContext
    )
    if (abortRequested(context, execContext, options)) {
      markToolCallCancelled('Request aborted during tool post-processing')
      markToolResultSeen(context, toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
        result: { cancelled: true },
        error: 'Request aborted during tool post-processing',
      }).catch((err) => {
        logger.warn('Failed to persist async tool status', {
          toolCallId: toolCall.id,
          error: toError(err).message,
        })
      })
      publishTerminalToolConfirmation({
        toolCallId: toolCall.id,
        status: MothershipStreamV1ToolOutcome.cancelled,
        message: 'Request aborted during tool post-processing',
        data: { cancelled: true },
      })
      endToolSpan('cancelled', { cancelReason: 'abort_during_post_processing_file' })
      return cancelledCompletion('Request aborted during tool post-processing')
    }
    result = await maybeWriteOutputToTable(
      toolCall.name,
      toolCall.params,
      result,
      toolExecutionContext
    )
    if (abortRequested(context, execContext, options)) {
      markToolCallCancelled('Request aborted during tool post-processing')
      markToolResultSeen(context, toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
        result: { cancelled: true },
        error: 'Request aborted during tool post-processing',
      }).catch((err) => {
        logger.warn('Failed to persist async tool status', {
          toolCallId: toolCall.id,
          error: toError(err).message,
        })
      })
      publishTerminalToolConfirmation({
        toolCallId: toolCall.id,
        status: MothershipStreamV1ToolOutcome.cancelled,
        message: 'Request aborted during tool post-processing',
        data: { cancelled: true },
      })
      endToolSpan('cancelled', { cancelReason: 'abort_during_post_processing_table' })
      return cancelledCompletion('Request aborted during tool post-processing')
    }
    result = await maybeWriteReadCsvToTable(
      toolCall.name,
      toolCall.params,
      result,
      toolExecutionContext
    )
    if (abortRequested(context, execContext, options)) {
      markToolCallCancelled('Request aborted during tool post-processing')
      markToolResultSeen(context, toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
        result: { cancelled: true },
        error: 'Request aborted during tool post-processing',
      }).catch((err) => {
        logger.warn('Failed to persist async tool status', {
          toolCallId: toolCall.id,
          error: toError(err).message,
        })
      })
      publishTerminalToolConfirmation({
        toolCallId: toolCall.id,
        status: MothershipStreamV1ToolOutcome.cancelled,
        message: 'Request aborted during tool post-processing',
        data: { cancelled: true },
      })
      endToolSpan('cancelled', { cancelReason: 'abort_during_post_processing_csv' })
      return cancelledCompletion('Request aborted during tool post-processing')
    }
    const projection = inspectToolResultForCopilot(
      result,
      toolExecutionContext.resolvedSecretTraceRegistry,
      toolCall.name
    )
    const copilotResult = projection.result
    mergeToolRegistry(projection.safe)
    const modelSucceeded = copilotResult.success

    toolSpan.attributes = {
      ...toolSpan.attributes,
      ...summarizeToolResultForSpan(copilotResult),
      ...(projection.safe
        ? {}
        : { resultWithheld: true, ...describeWithholdingCause(projection.cause) }),
    }
    if (!projection.safe) {
      // A withheld SUCCESS otherwise leaves no trace anywhere: the span reads
      // ok and the model just sees a bare `{success: true}` with no output.
      // The cause is what says whether a guard latched, no catalog was built,
      // or the payload itself was unprojectable — three different fixes.
      logger.warn('Tool result withheld by egress projection', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        runtimeSucceeded: result.success,
        ...describeWithholdingCause(projection.cause),
      })
    }

    setTerminalToolCallState(toolCall, {
      status: copilotResult.success
        ? MothershipStreamV1ToolOutcome.success
        : MothershipStreamV1ToolOutcome.error,
      ...(hasOutputValue(copilotResult) ? { output: copilotResult.output } : {}),
      ...(copilotResult.success ? {} : { error: copilotResult.error || 'Tool failed' }),
    })

    if (modelSucceeded) {
      // Log the model-facing (redacted) view, not result.output — for
      // generate_api_key the raw output carries the plaintext key, which must
      // never reach application logs.
      const raw = getToolCallTerminalData(toolCall)
      const preview =
        typeof raw === 'string'
          ? raw.slice(0, 200)
          : raw && typeof raw === 'object'
            ? JSON.stringify(raw).slice(0, 200)
            : undefined
      logger.info('Tool execution succeeded', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        outputPreview: preview,
      })
    } else {
      logger.warn('Tool execution failed', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: copilotResult.error,
        params: toolCall.params,
        runtimeSucceeded: result.success,
      })
    }

    if (toolCall.name === CreateWorkflow.id && result.success) {
      applyCreateWorkflowOutputToContext(result.output, execContext)
    }

    const terminalStatus = modelSucceeded
      ? MothershipStreamV1ToolOutcome.success
      : MothershipStreamV1ToolOutcome.error
    const terminalMessage = modelSucceeded ? 'Tool completed' : requireToolCallError(toolCall)
    const terminalData = getToolCallTerminalData(toolCall)

    markToolResultSeen(context, toolCall.id)
    await completeAsyncToolCall({
      toolCallId: toolCall.id,
      status: modelSucceeded
        ? MothershipStreamV1AsyncToolRecordStatus.completed
        : MothershipStreamV1AsyncToolRecordStatus.failed,
      ...(terminalData !== undefined ? { result: terminalData } : {}),
      error: modelSucceeded ? null : terminalMessage,
    }).catch((err) => {
      logger.warn('Failed to persist async tool completion', {
        toolCallId: toolCall.id,
        error: toError(err).message,
      })
    })
    publishTerminalToolConfirmation({
      toolCallId: toolCall.id,
      status: terminalStatus,
      message: terminalMessage,
      ...(terminalData !== undefined ? { data: terminalData } : {}),
    })

    if (abortRequested(context, execContext, options)) {
      markToolCallCancelled('Request aborted before tool result delivery')
      endToolSpan('cancelled', { cancelReason: 'abort_before_tool_result_delivery' })
      return cancelledCompletion('Request aborted before tool result delivery')
    }

    // A newly generated API key is intentionally included only in this
    // live/replay client event. Model-facing results and long-term chat records stay redacted.
    const clientEventOutput =
      toolCall.name === GenerateApiKey.id && modelSucceeded && hasOutputValue(copilotResult)
        ? copilotResult.output
        : terminalData
    const resultEvent: StreamEvent = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        success: modelSucceeded,
        output: clientEventOutput,
        ...(modelSucceeded
          ? { status: MothershipStreamV1ToolOutcome.success }
          : { status: MothershipStreamV1ToolOutcome.error, error: terminalMessage }),
      },
    }
    await options?.onEvent?.(resultEvent)

    if (abortRequested(context, execContext, options)) {
      markToolCallCancelled('Request aborted before resource persistence')
      endToolSpan('cancelled', { cancelReason: 'abort_before_resource_persistence' })
      return cancelledCompletion('Request aborted before resource persistence')
    }

    if (result.success && execContext.chatId && !abortRequested(context, execContext, options)) {
      await handleResourceSideEffects(
        toolCall.name,
        toolCall.params,
        result,
        copilotResult,
        execContext.chatId,
        options?.onEvent,
        () => abortRequested(context, execContext, options)
      )
    }
    endToolSpan(modelSucceeded ? 'ok' : 'error', {
      resultSuccess: modelSucceeded,
      ...(modelSucceeded ? {} : { error: terminalMessage }),
    })
    return buildCompletionSignal({
      status: terminalStatus,
      message: terminalMessage,
      ...(terminalData !== undefined ? { data: terminalData } : {}),
    })
  } catch (error) {
    const thrownMessage = enrichOpaqueToolError(
      toError(error).message,
      toolCall.name,
      toolCall.startTime
    )
    const projection = inspectToolResultForCopilot(
      { success: false, error: thrownMessage },
      toolExecutionContext.resolvedSecretTraceRegistry,
      toolCall.name
    )
    const copilotError = projection.result
    mergeToolRegistry(projection.safe)
    const safeThrownMessage = copilotError.error || 'Tool failed'
    if (abortRequested(context, execContext, options)) {
      markToolCallCancelled('Request aborted during tool execution')
      markToolResultSeen(context, toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: MothershipStreamV1AsyncToolRecordStatus.cancelled,
        result: { cancelled: true },
        error: 'Request aborted during tool execution',
      }).catch((err) => {
        logger.warn('Failed to persist async tool status', {
          toolCallId: toolCall.id,
          error: toError(err).message,
        })
      })
      publishTerminalToolConfirmation({
        toolCallId: toolCall.id,
        status: MothershipStreamV1ToolOutcome.cancelled,
        message: 'Request aborted during tool execution',
        data: { cancelled: true },
      })
      endToolSpan('cancelled', {
        cancelReason: 'abort_during_execution_catch',
        error: safeThrownMessage,
      })
      return cancelledCompletion('Request aborted during tool execution')
    }
    setTerminalToolCallState(toolCall, {
      status: MothershipStreamV1ToolOutcome.error,
      error: safeThrownMessage,
    })

    logger.error('Tool execution threw', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      error: toolCall.error,
      params: toolCall.params,
    })

    markToolResultSeen(context, toolCall.id)
    await completeAsyncToolCall({
      toolCallId: toolCall.id,
      status: MothershipStreamV1AsyncToolRecordStatus.failed,
      result: { error: toolCall.error },
      error: toolCall.error,
    }).catch((err) => {
      logger.warn('Failed to persist async tool error', {
        toolCallId: toolCall.id,
        error: toError(err).message,
      })
    })
    publishTerminalToolConfirmation({
      toolCallId: toolCall.id,
      status: MothershipStreamV1ToolOutcome.error,
      message: toolCall.error,
      data: { error: toolCall.error },
    })

    const errorEvent: StreamEvent = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        status: MothershipStreamV1ToolOutcome.error,
        success: false,
        error: toolCall.error,
        output: { error: toolCall.error },
      },
    }
    await options?.onEvent?.(errorEvent)
    endToolSpan('error', { error: safeThrownMessage })
    return buildCompletionSignal({
      status: MothershipStreamV1ToolOutcome.error,
      message: toolCall.error,
      data: { error: toolCall.error },
    })
  }
}
