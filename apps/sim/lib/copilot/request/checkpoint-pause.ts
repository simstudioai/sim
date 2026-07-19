/**
 * Shared checkpoint-pause protocol helpers.
 *
 * A `run.checkpoint_pause` frame means Go paused the stream on tools it does
 * not execute itself. What happens next depends on who can run them: the
 * Next server executes sim-routed tools inside the same request, full app
 * clients execute every client tool, and lighter surfaces (the Quick Ask
 * launcher) execute only some. This module owns the frame's shape (pending
 * ids live both top-level and per-subagent) and the coverage rule, so those
 * surfaces cannot drift from the wire protocol independently.
 *
 * Client-safe: pure functions over the parsed payload, no server imports.
 */
import { isSimExecuted } from '@/lib/copilot/tool-executor/router'
import { isWorkflowToolName } from '@/lib/copilot/tools/workflow-tools'

/**
 * Collects every pending tool-call id from a checkpoint_pause payload: the
 * top-level bundle plus each per-subagent frame.
 */
export function extractPendingToolCallIds(payload: Record<string, unknown>): string[] {
  const topLevel = Array.isArray(payload.pendingToolCallIds)
    ? (payload.pendingToolCallIds as unknown[])
    : []
  const frames = Array.isArray(payload.frames)
    ? (payload.frames as Array<{ pendingToolIds?: unknown }>)
    : []
  return [
    ...topLevel,
    ...frames.flatMap((frame) => (Array.isArray(frame.pendingToolIds) ? frame.pendingToolIds : [])),
  ].filter((id): id is string => typeof id === 'string')
}

/** What a surface observed about a pending tool call from its call frame. */
export interface PendingToolCallInfo {
  toolName: string
  executor?: string
}

/**
 * Whether a checkpoint-paused tool call will complete without further help
 * from this surface: either the surface already dispatched it locally, or the
 * Next server executes it inside the same request (sim-routed tools, minus
 * workflow runs which the server delegates to full clients). Unknown ids
 * (no call frame seen) are conservatively uncovered.
 */
export function isCheckpointPauseCovered(
  info: PendingToolCallInfo | undefined,
  dispatchedLocally: boolean
): boolean {
  if (dispatchedLocally) return true
  if (!info) return false
  if (isWorkflowToolName(info.toolName)) return false
  return info.executor === 'sim' || isSimExecuted(info.toolName)
}
