import { STREAM_BUFFER_MAX_DEDUP_ENTRIES } from '@/lib/copilot/constants'
import {
  isToolCallStreamEvent,
  isToolResultStreamEvent,
  type ToolCallStreamEvent,
  type ToolResultStreamEvent,
} from '@/lib/copilot/request/session'
import { TOOL_CALL_STATUS } from '@/lib/copilot/request/session/event'
import type { StreamEvent } from '@/lib/copilot/request/types'

/** Safely cast event.data to a record for property access. */
export const asRecord = (data: unknown): Record<string, unknown> =>
  (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>

/**
 * In-memory tool event dedupe with bounded size.
 *
 * NOTE: Process-local only. In a multi-instance setup (e.g., ECS),
 * each task maintains its own dedupe cache.
 */
const seenToolCalls = new Set<string>()
const seenToolResults = new Set<string>()

function addToSet(set: Set<string>, id: string): void {
  if (set.size >= STREAM_BUFFER_MAX_DEDUP_ENTRIES) {
    const first = set.values().next().value
    if (first) set.delete(first)
  }
  set.add(id)
}

function getToolCallIdFromCallEvent(event: ToolCallStreamEvent): string {
  return event.payload.toolCallId
}

function getToolCallIdFromResultEvent(event: ToolResultStreamEvent): string {
  return event.payload.toolCallId
}

function markToolCallSeen(toolCallId: string): void {
  addToSet(seenToolCalls, toolCallId)
}

function wasToolCallSeen(toolCallId: string): boolean {
  return seenToolCalls.has(toolCallId)
}

export function markToolResultSeen(toolCallId: string): void {
  addToSet(seenToolResults, toolCallId)
}

export function wasToolResultSeen(toolCallId: string): boolean {
  return seenToolResults.has(toolCallId)
}

export function shouldSkipToolCallEvent(event: StreamEvent): boolean {
  if (!isToolCallStreamEvent(event)) return false
  if (event.payload.status === TOOL_CALL_STATUS.generating) return false
  const toolCallId = getToolCallIdFromCallEvent(event)
  if (event.payload.partial === true) return false
  if (wasToolResultSeen(toolCallId) || wasToolCallSeen(toolCallId)) return true
  markToolCallSeen(toolCallId)
  return false
}

export function shouldSkipToolResultEvent(event: StreamEvent): boolean {
  return isToolResultStreamEvent(event) && wasToolResultSeen(getToolCallIdFromResultEvent(event))
}
