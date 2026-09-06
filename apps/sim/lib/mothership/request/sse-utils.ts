import {
  isToolCallStreamEvent,
  isToolResultStreamEvent,
  type ToolCallStreamEvent,
  type ToolResultStreamEvent,
} from '@/lib/mothership/request/session'
import { TOOL_CALL_STATUS } from '@/lib/mothership/request/session/event'
import type { StreamEvent, StreamingContext } from '@/lib/mothership/request/types'

/**
 * Tool event dedupe, scoped to one turn's StreamingContext (the sets live and die with
 * the turn). The semantics enforced — skip retransmits of a frame across a turn's
 * retry/resume legs — are per-turn, so per-turn state is both correct and unbounded-safe.
 */
type DedupeScope = Pick<StreamingContext, 'seenToolCalls' | 'seenToolResults'>

function getToolCallIdFromCallEvent(event: ToolCallStreamEvent): string {
  return event.payload.toolCallId
}

function getToolCallIdFromResultEvent(event: ToolResultStreamEvent): string {
  return event.payload.toolCallId
}

function toolCallDedupeKey(toolCallId: string, toolName: string): string {
  return `${toolCallId}\u0000${toolName}`
}

function markToolCallSeen(scope: DedupeScope, toolCallId: string, toolName: string): void {
  scope.seenToolCalls.add(toolCallDedupeKey(toolCallId, toolName))
}

function wasToolCallSeen(scope: DedupeScope, toolCallId: string, toolName: string): boolean {
  return scope.seenToolCalls.has(toolCallDedupeKey(toolCallId, toolName))
}

export function markToolResultSeen(scope: DedupeScope, toolCallId: string): void {
  scope.seenToolResults.add(toolCallId)
}

export function wasToolResultSeen(scope: DedupeScope, toolCallId: string): boolean {
  return scope.seenToolResults.has(toolCallId)
}

export function shouldSkipToolCallEvent(scope: DedupeScope, event: StreamEvent): boolean {
  if (!isToolCallStreamEvent(event)) return false
  /** A history receipt does not consume the later executable handoff for the same call. */
  if (event.payload.replay) return false
  if (isPathlessVfsGeneratingEvent(event)) return true
  if (event.payload.status === TOOL_CALL_STATUS.generating) return false
  const toolCallId = getToolCallIdFromCallEvent(event)
  if (event.payload.partial === true) return false
  const toolName = event.payload.toolName
  // A resolved integration gateway intentionally emits two authoritative
  // call frames under one provider call ID: first call_integration_tool, then
  // the exact request-local operation. Deduplicate retransmits of the same
  // frame, but allow the name transition through to execution and UI rebinding.
  if (wasToolResultSeen(scope, toolCallId) || wasToolCallSeen(scope, toolCallId, toolName))
    return true
  markToolCallSeen(scope, toolCallId, toolName)
  return false
}

function isPathlessVfsGeneratingEvent(event: ToolCallStreamEvent): boolean {
  if (event.payload.status !== TOOL_CALL_STATUS.generating) return false
  if (event.payload.toolName !== 'read' && event.payload.toolName !== 'glob') return false
  return event.payload.arguments === undefined
}

export function shouldSkipToolResultEvent(scope: DedupeScope, event: StreamEvent): boolean {
  return (
    isToolResultStreamEvent(event) && wasToolResultSeen(scope, getToolCallIdFromResultEvent(event))
  )
}
