/**
 * Shared client-side reducer for agent-stream tool chips.
 *
 * The public chat hook, the canvas execution hook, and the terminal console
 * store all consume the same tool lifecycle (keyed ordered upsert on
 * start/end, settle-running-on-terminal). This module is the single
 * implementation so the three surfaces cannot drift.
 */

import { humanizeToolName } from '@/lib/copilot/tools/tool-display'

export type AgentStreamToolStatus = 'running' | 'success' | 'error' | 'cancelled'

export interface AgentStreamToolCall {
  key: string
  id: string
  name: string
  displayName?: string
  status: AgentStreamToolStatus
}

/** Terminal statuses a running chip can settle to. */
export type AgentStreamToolTerminalStatus = Exclude<AgentStreamToolStatus, 'running'>

/** Canonical chip key — unique per block and tool call within an execution. */
export function toolCallKey(blockId: string, id: string): string {
  return `${blockId}:${id}`
}

/** Normalizes a wire `status` into a terminal chip status (default success). */
export function resolveToolCallEndStatus(status?: string): AgentStreamToolTerminalStatus {
  return status === 'error' || status === 'cancelled' ? status : 'success'
}

/**
 * Applies a tool lifecycle phase to a keyed map + insertion-order list.
 * `extend` lets callers add surface-specific fields (e.g. chat's `blockId`).
 */
export function applyToolCallPhase<T extends AgentStreamToolCall>(
  map: Map<string, T>,
  order: string[],
  event: { key: string; id: string; name: string; phase: 'start' | 'end'; status?: string },
  extend: (tool: AgentStreamToolCall) => T
): void {
  const { key } = event
  if (event.phase === 'start') {
    if (!map.has(key)) {
      order.push(key)
    }
    map.set(
      key,
      extend({
        key,
        id: event.id,
        name: event.name,
        displayName: humanizeToolName(event.name),
        status: 'running',
      })
    )
    return
  }

  const endStatus = resolveToolCallEndStatus(event.status)
  const existing = map.get(key)
  if (!existing) {
    order.push(key)
    map.set(
      key,
      extend({
        key,
        id: event.id,
        name: event.name,
        displayName: humanizeToolName(event.name),
        status: endStatus,
      })
    )
    return
  }
  map.set(key, { ...existing, status: endStatus })
}

/** Settles every still-running chip in the map to a terminal status. */
export function settleRunningToolCalls<T extends AgentStreamToolCall>(
  map: Map<string, T>,
  status: AgentStreamToolTerminalStatus
): void {
  for (const [key, tool] of map) {
    if (tool.status === 'running') {
      map.set(key, { ...tool, status })
    }
  }
}

/** List variant of {@link settleRunningToolCalls} for immutable store entries. */
export function settleRunningToolCallList<T extends AgentStreamToolCall>(
  toolCalls: T[] | undefined,
  status: AgentStreamToolTerminalStatus
): T[] | undefined {
  return toolCalls?.map((tool) => (tool.status === 'running' ? { ...tool, status } : tool))
}

/** Ordered snapshot of the map, or undefined when no chips exist. */
export function snapshotToolCalls<T extends AgentStreamToolCall>(
  order: string[],
  map: Map<string, T>
): T[] | undefined {
  if (order.length === 0) return undefined
  return order.map((key) => map.get(key)).filter((tool): tool is T => Boolean(tool))
}

/** True while any chip is still running. */
export function anyToolCallRunning<T extends AgentStreamToolCall>(map: Map<string, T>): boolean {
  for (const tool of map.values()) {
    if (tool.status === 'running') return true
  }
  return false
}
