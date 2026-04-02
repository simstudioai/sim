import { createLogger } from '@sim/logger'
import {
  MothershipStreamV1EventType,
  type MothershipStreamV1StreamScope,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { asRecord, getEventData, markToolResultSeen } from '@/lib/copilot/request/sse-utils'
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

export type ToolScope = MothershipStreamV1StreamScope['lane']

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

export function getScopedParentToolCallId(
  event: StreamEvent,
  context: StreamingContext
): string | undefined {
  return event.scope?.parentToolCallId || context.subAgentParentToolCallId
}

export function registerPendingToolPromise(
  context: StreamingContext,
  toolCallId: string,
  pendingPromise: Promise<{ status: string; message?: string; data?: Record<string, unknown> }>
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
  return true
}

/**
 * Extract the `ui` object from a Go SSE event. The Go backend enriches
 * tool_call events with `ui: { requiresConfirmation, clientExecutable, ... }`.
 */
export function getEventUI(event: StreamEvent): {
  requiresConfirmation: boolean
  clientExecutable: boolean
  simExecutable: boolean
  internal: boolean
  hidden: boolean
} {
  const data = getEventData(event)
  const raw = asRecord(data?.ui)
  return {
    requiresConfirmation: raw.requiresConfirmation === true || data?.requiresConfirmation === true,
    clientExecutable:
      raw.clientExecutable === true || data?.executor === MothershipStreamV1ToolExecutor.client,
    simExecutable: data?.executor === MothershipStreamV1ToolExecutor.sim,
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
  completion: { status: string; message?: string; data?: Record<string, unknown> } | null
): void {
  if (completion?.status === 'background') {
    toolCall.status = MothershipStreamV1ToolOutcome.skipped
    toolCall.result = completion?.data ? { success: true, output: completion.data } : undefined
    toolCall.endTime = Date.now()
    markToolResultSeen(toolCallId)
    return
  }
  if (completion?.status === MothershipStreamV1ToolOutcome.rejected) {
    toolCall.status = MothershipStreamV1ToolOutcome.rejected
    toolCall.error = completion?.message || 'Tool rejected'
    toolCall.result = {
      success: false,
      output: completion?.data ?? { error: toolCall.error },
    }
    toolCall.endTime = Date.now()
    markToolResultSeen(toolCallId)
    return
  }
  if (completion?.status === MothershipStreamV1ToolOutcome.cancelled) {
    toolCall.status = MothershipStreamV1ToolOutcome.cancelled
    toolCall.error = completion?.message || 'Tool cancelled'
    toolCall.result = {
      success: false,
      output: completion?.data ?? { error: toolCall.error },
    }
    toolCall.endTime = Date.now()
    markToolResultSeen(toolCallId)
    return
  }
  const success = completion?.status === MothershipStreamV1ToolOutcome.success
  toolCall.status = success
    ? MothershipStreamV1ToolOutcome.success
    : MothershipStreamV1ToolOutcome.error
  toolCall.result = {
    success,
    output: completion?.data ?? (success ? {} : { error: completion?.message || 'Tool failed' }),
  }
  toolCall.error = success ? undefined : completion?.message || 'Tool failed'
  toolCall.endTime = Date.now()
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
  completion: { status: string; message?: string; data?: Record<string, unknown> } | null,
  options: OrchestratorOptions
): Promise<void> {
  const success = completion?.status === MothershipStreamV1ToolOutcome.success
  const isCancelled = completion?.status === MothershipStreamV1ToolOutcome.cancelled

  const resultPayload = isCancelled
    ? { ...completion?.data, reason: 'user_cancelled', cancelledByUser: true }
    : completion?.data

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
        result: resultPayload,
        ...(completion?.status ? { status: completion.status } : {}),
        ...(!success && completion?.message ? { error: completion.message } : {}),
      },
    })
  } catch (error) {
    logger.warn('Failed to emit synthetic tool_result', {
      toolCallId,
      toolName,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function inferToolSuccess(data: Record<string, unknown> | undefined): {
  success: boolean
  hasResultData: boolean
  hasError: boolean
} {
  const resultObj = asRecord(data?.result)
  const hasExplicitSuccess = data?.success !== undefined || resultObj.success !== undefined
  const explicitSuccess = data?.success ?? resultObj.success
  const hasResultData = data?.result !== undefined || data?.data !== undefined
  const hasError = !!data?.error || !!resultObj.error
  const success = hasExplicitSuccess ? !!explicitSuccess : !hasError
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
