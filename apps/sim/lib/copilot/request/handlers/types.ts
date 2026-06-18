import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type {
  AsyncCompletionSignal,
  AsyncTerminalCompletionSnapshot,
} from '@/lib/copilot/async-runs/lifecycle'
import { ASYNC_TOOL_CONFIRMATION_STATUS } from '@/lib/copilot/async-runs/lifecycle'
import {
  MothershipStreamV1EventType,
  type MothershipStreamV1StreamScope,
  type MothershipStreamV1ToolCallDescriptor,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
  type MothershipStreamV1ToolResultPayload,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { asRecord, markToolResultSeen } from '@/lib/copilot/request/sse-utils'
import { setTerminalToolCallState } from '@/lib/copilot/request/tool-call-state'
import type {
  ContentBlock,
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/request/types'

export type StreamHandler = (
  event: StreamEvent,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions
) => void | Promise<void>

export type ToolScope = 'main' | MothershipStreamV1StreamScope['lane']

const logger = createLogger('CopilotHandlerHelpers')

export function addContentBlock(
  context: StreamingContext,
  block: Omit<ContentBlock, 'timestamp'>
): void {
  context.contentBlocks.push({
    ...block,
    timestamp: Date.now(),
  })
}

export function stampBlockEnd(block: ContentBlock): void {
  if (block.endedAt === undefined) block.endedAt = Date.now()
}

/**
 * Flush any open thinking block into contentBlocks and clear the thinking state.
 * Safe to call repeatedly.
 */
export function flushThinkingBlock(context: StreamingContext): void {
  if (context.currentThinkingBlock) {
    stampBlockEnd(context.currentThinkingBlock)
    context.contentBlocks.push(context.currentThinkingBlock)
  }
  context.isInThinkingBlock = false
  context.currentThinkingBlock = null
}

/**
 * Flush open subagent thinking blocks into contentBlocks. With a parentToolCallId
 * it flushes only that lane (used when a tool/text event arrives for a specific
 * subagent); with no argument it flushes ALL open lanes (used at stream end and
 * at subagent lifecycle boundaries). Safe to call repeatedly.
 */
export function flushSubagentThinkingBlock(
  context: StreamingContext,
  parentToolCallId?: string
): void {
  if (parentToolCallId !== undefined) {
    const block = context.subagentThinkingBlocks.get(parentToolCallId)
    if (block) {
      stampBlockEnd(block)
      context.contentBlocks.push(block)
      context.subagentThinkingBlocks.delete(parentToolCallId)
    }
    return
  }
  for (const block of context.subagentThinkingBlocks.values()) {
    stampBlockEnd(block)
    context.contentBlocks.push(block)
  }
  context.subagentThinkingBlocks.clear()
}

/**
 * Resolve the subagent lane an event belongs to, using ONLY the event's own
 * scope. The legacy fallback to a single "current subagent" pointer was removed:
 * with concurrent subagents that pointer reflects whichever subagent started
 * most recently and would mis-attribute interleaved events. Every subagent-lane
 * event is guaranteed to carry parentToolCallId (Go stamps it), so a missing one
 * is a real contract violation — callers warn and drop rather than guess.
 */
export function getScopedParentToolCallId(
  event: StreamEvent,
  _context: StreamingContext
): string | undefined {
  return event.scope?.parentToolCallId
}

/**
 * Extract the deterministic span identity from an event's scope. Returns an
 * empty object for legacy events that predate span identity so callers can
 * spread it safely and fall back to `parentToolCallId`-based grouping.
 */
export function getScopedSpanIdentity(event: StreamEvent): {
  spanId?: string
  parentSpanId?: string
} {
  const spanId = event.scope?.spanId
  const parentSpanId = event.scope?.parentSpanId
  return {
    ...(spanId ? { spanId } : {}),
    ...(parentSpanId ? { parentSpanId } : {}),
  }
}

export function registerPendingToolPromise(
  context: StreamingContext,
  toolCallId: string,
  pendingPromise: Promise<AsyncCompletionSignal>
): void {
  context.pendingToolPromises.set(toolCallId, pendingPromise)
  pendingPromise.finally(() => {
    if (context.pendingToolPromises.get(toolCallId) === pendingPromise) {
      context.pendingToolPromises.delete(toolCallId)
    }
  })
}

/**
 * When the Sim->Go stream is aborted, avoid starting server-side tool work and
 * unblock the Go async waiter with a terminal 499 completion.
 */
export function abortPendingToolIfStreamDead(
  toolCall: ToolCallState,
  toolCallId: string,
  options: OrchestratorOptions,
  context: StreamingContext
): boolean {
  if (!options.abortSignal?.aborted && !context.wasAborted) {
    return false
  }
  toolCall.status = MothershipStreamV1ToolOutcome.cancelled
  toolCall.endTime = Date.now()
  markToolResultSeen(toolCallId)
  const toolSpan = context.trace.startSpan(toolCall.name || 'unknown_tool', 'tool.execute', {
    toolCallId,
    toolName: toolCall.name,
    cancelReason: 'stream_dead_before_dispatch',
    abortSignalAborted: options.abortSignal?.aborted ?? false,
    abortReason: options.abortSignal?.aborted
      ? String(options.abortSignal.reason ?? 'unknown')
      : undefined,
    wasAborted: context.wasAborted ?? false,
  })
  context.trace.endSpan(toolSpan, 'cancelled')
  return true
}

/**
 * Extract the behavioral `ui` flags from a typed tool_call payload. The Go
 * backend enriches tool_call events with `ui: { clientExecutable, internal,
 * hidden }`; presentation (title/icon) is derived client-side from the tool name.
 */
export function getToolCallUI(data: MothershipStreamV1ToolCallDescriptor): {
  clientExecutable: boolean
  simExecutable: boolean
  internal: boolean
  hidden: boolean
} {
  const raw = asRecord(data.ui)
  return {
    clientExecutable:
      raw.clientExecutable === true || data.executor === MothershipStreamV1ToolExecutor.client,
    simExecutable: data.executor === MothershipStreamV1ToolExecutor.sim,
    internal: raw.internal === true,
    hidden: raw.hidden === true,
  }
}

/**
 * Handle the completion signal from a client-executable tool.
 * Shared by both main and subagent scopes.
 */
export function handleClientCompletion(
  toolCall: ToolCallState,
  toolCallId: string,
  completion: AsyncTerminalCompletionSnapshot | null
): void {
  if (completion?.status === ASYNC_TOOL_CONFIRMATION_STATUS.background) {
    setTerminalToolCallState(toolCall, {
      status: MothershipStreamV1ToolOutcome.skipped,
      ...(completion.data !== undefined ? { output: completion.data } : {}),
    })
    markToolResultSeen(toolCallId)
    return
  }
  if (completion?.status === MothershipStreamV1ToolOutcome.cancelled) {
    setTerminalToolCallState(toolCall, {
      status: MothershipStreamV1ToolOutcome.cancelled,
      ...(completion.data !== undefined ? { output: completion.data } : {}),
      error: completion.message || 'Tool cancelled',
    })
    markToolResultSeen(toolCallId)
    return
  }
  const success = completion?.status === MothershipStreamV1ToolOutcome.success
  setTerminalToolCallState(toolCall, {
    status: success ? MothershipStreamV1ToolOutcome.success : MothershipStreamV1ToolOutcome.error,
    ...(completion?.data !== undefined ? { output: completion.data } : {}),
    ...(success ? {} : { error: completion?.message || 'Tool failed' }),
  })
  markToolResultSeen(toolCallId)
}

/**
 * Emit a synthetic tool_result SSE event to the client after a client-executable
 * tool completes. The Go backend's actual tool_result is skipped (markToolResultSeen),
 * so the client would never learn the outcome without this.
 */
export async function emitSyntheticToolResult(
  toolCallId: string,
  toolName: string,
  completion: AsyncTerminalCompletionSnapshot | null,
  options: OrchestratorOptions
): Promise<void> {
  const isBackground = completion?.status === ASYNC_TOOL_CONFIRMATION_STATUS.background
  const success = isBackground || completion?.status === MothershipStreamV1ToolOutcome.success
  const isCancelled = completion?.status === MothershipStreamV1ToolOutcome.cancelled
  const completionData = completion?.data
  const syntheticStatus = isBackground
    ? MothershipStreamV1ToolOutcome.skipped
    : completion?.status === MothershipStreamV1ToolOutcome.success ||
        completion?.status === MothershipStreamV1ToolOutcome.error ||
        completion?.status === MothershipStreamV1ToolOutcome.cancelled
      ? completion.status
      : undefined

  const resultPayload = isCancelled
    ? isRecordLike(completionData)
      ? { ...completionData, reason: 'user_cancelled', cancelledByUser: true }
      : completionData !== undefined
        ? { output: completionData, reason: 'user_cancelled', cancelledByUser: true }
        : { reason: 'user_cancelled', cancelledByUser: true }
    : completionData

  try {
    await options.onEvent?.({
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId,
        toolName,
        executor: MothershipStreamV1ToolExecutor.client,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.result,
        success,
        output: resultPayload,
        ...(syntheticStatus ? { status: syntheticStatus } : {}),
        ...(!success && completion?.message ? { error: completion.message } : {}),
      },
    })
  } catch (error) {
    logger.warn('Failed to emit synthetic tool_result', {
      toolCallId,
      toolName,
      error: toError(error).message,
    })
  }
}

export function getToolResultErrorMessage(
  data: MothershipStreamV1ToolResultPayload | undefined
): string | undefined {
  return data?.error
}

export function inferToolSuccess(data: MothershipStreamV1ToolResultPayload | undefined): {
  success: boolean
  hasResultData: boolean
  hasError: boolean
} {
  const errorMessage = getToolResultErrorMessage(data)
  const hasResultData = data?.output !== undefined
  const hasError = Boolean(errorMessage)
  const success = data?.success === true
  return { success, hasResultData, hasError }
}

export function ensureTerminalToolCallState(
  context: StreamingContext,
  toolCallId: string,
  toolName: string
): ToolCallState {
  const existing = context.toolCalls.get(toolCallId)
  if (existing) {
    return existing
  }

  const toolCall: ToolCallState = {
    id: toolCallId,
    name: toolName || 'unknown_tool',
    status: 'pending',
    startTime: Date.now(),
  }
  context.toolCalls.set(toolCallId, toolCall)
  addContentBlock(context, { type: 'tool_call', toolCall })
  return toolCall
}
