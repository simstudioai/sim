import { STREAM_BUFFER_MAX_DEDUP_ENTRIES } from '@/lib/copilot/constants'
import type { SSEEvent } from '@/lib/copilot/orchestrator/types'

type EventDataObject = Record<string, unknown> | undefined

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

const parseEventData = (data: unknown): EventDataObject => {
  if (!data) return undefined
  if (typeof data !== 'string') {
    return data as EventDataObject
  }
  try {
    return JSON.parse(data) as EventDataObject
  } catch {
    return undefined
  }
}

const hasToolFields = (data: EventDataObject): boolean => {
  if (!data) return false
  return (
    data.id !== undefined ||
    data.toolCallId !== undefined ||
    data.name !== undefined ||
    data.success !== undefined ||
    data.result !== undefined ||
    data.arguments !== undefined
  )
}

export const getEventData = (event: SSEEvent): EventDataObject => {
  const topLevel = parseEventData(event.data)
  if (!topLevel) return undefined
  if (hasToolFields(topLevel)) return topLevel
  const nested = parseEventData(topLevel.data)
  return nested || topLevel
}

function getToolCallIdFromEvent(event: SSEEvent): string | undefined {
  const data = getEventData(event)
  return event.toolCallId || (data?.id as string | undefined) || (data?.toolCallId as string | undefined)
}

/** Normalizes SSE events so tool metadata is available at the top level. */
export function normalizeSseEvent(event: SSEEvent): SSEEvent {
  if (!event) return event
  const data = getEventData(event)
  if (!data) return event
  const toolCallId = event.toolCallId || (data.id as string | undefined) || (data.toolCallId as string | undefined)
  const toolName = event.toolName || (data.name as string | undefined) || (data.toolName as string | undefined)
  const success = event.success ?? (data.success as boolean | undefined)
  const result = event.result ?? data.result
  const normalizedData = typeof event.data === 'string' ? data : event.data
  return {
    ...event,
    data: normalizedData,
    toolCallId,
    toolName,
    success,
    result,
  }
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

export function shouldSkipToolCallEvent(event: SSEEvent): boolean {
  if (event.type !== 'tool_call') return false
  const toolCallId = getToolCallIdFromEvent(event)
  if (!toolCallId) return false
  const eventData = getEventData(event)
  if (eventData?.partial === true) return false
  if (wasToolResultSeen(toolCallId) || wasToolCallSeen(toolCallId)) {
    return true
  }
  markToolCallSeen(toolCallId)
  return false
}

export function shouldSkipToolResultEvent(event: SSEEvent): boolean {
  if (event.type !== 'tool_result') return false
  const toolCallId = getToolCallIdFromEvent(event)
  if (!toolCallId) return false
  if (wasToolResultSeen(toolCallId)) return true
  markToolResultSeen(toolCallId)
  return false
}
