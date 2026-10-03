import { getBrowserSession, useBrowserSessionStore } from '@/stores/browser-session/store'
import { getCopilotTerminalSession, useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

/** Activity owned by one chat-stream generation across reconnect legs and scope migration. */
export interface ResourceActivityTracker {
  generation: number
  scopeIds: Set<string>
  currentScopeId: string
  browserRunIds: Set<string>
  terminalToolCallIds: Set<string>
  cleared: boolean
}

/** Captures activity already visible in a scope, such as when reconnecting mid-turn. */
export function captureResourceActivityScope(
  tracker: ResourceActivityTracker,
  scopeId: string
): void {
  if (!scopeId) return
  tracker.scopeIds.add(scopeId)
  tracker.currentScopeId = scopeId
  for (const runId of getBrowserSession(scopeId).agentRunIds) {
    tracker.browserRunIds.add(runId)
  }
  for (const toolCallId of Object.keys(
    getCopilotTerminalSession(scopeId).agentCommandTerminalIds
  )) {
    tracker.terminalToolCallIds.add(toolCallId)
  }
}

/** Creates a tracker and seeds it with any activity restored before the stream reconnects. */
export function createResourceActivityTracker(
  generation: number,
  scopeIds: Iterable<string>,
  options?: { captureExisting?: boolean }
): ResourceActivityTracker {
  const tracker: ResourceActivityTracker = {
    generation,
    scopeIds: new Set(),
    currentScopeId: '',
    browserRunIds: new Set(),
    terminalToolCallIds: new Set(),
    cleared: false,
  }
  for (const scopeId of scopeIds) {
    if (options?.captureExisting === false) {
      tracker.scopeIds.add(scopeId)
      tracker.currentScopeId = scopeId
    } else captureResourceActivityScope(tracker, scopeId)
  }
  return tracker
}

/** Records a browser span against this stream while preserving exact run identity. */
export function setTrackedBrowserRun(
  tracker: ResourceActivityTracker,
  scopeId: string,
  runId: string,
  active: boolean
): void {
  if (scopeId) {
    tracker.scopeIds.add(scopeId)
    tracker.currentScopeId = scopeId
  }
  tracker.cleared = false
  const browserStore = useBrowserSessionStore.getState()
  if (active) {
    tracker.browserRunIds.add(runId)
    browserStore.setAgentRunActive(scopeId, runId, true)
    return
  }
  tracker.browserRunIds.delete(runId)
  browserStore.clearAgentRunIds([runId])
}

/** Records an exact terminal tool before its native command-start event arrives. */
export function trackTerminalToolCall(
  tracker: ResourceActivityTracker,
  scopeId: string,
  toolCallId: string
): void {
  if (scopeId) {
    tracker.scopeIds.add(scopeId)
    tracker.currentScopeId = scopeId
  }
  tracker.cleared = false
  tracker.terminalToolCallIds.add(toolCallId)
}

/** Prevents stale cleanup from settling exact ids adopted by a newer reader. */
export function excludeActivityOwnedBy(
  tracker: ResourceActivityTracker,
  currentOwner: ResourceActivityTracker
): void {
  for (const runId of currentOwner.browserRunIds) tracker.browserRunIds.delete(runId)
  for (const toolCallId of currentOwner.terminalToolCallIds) {
    tracker.terminalToolCallIds.delete(toolCallId)
  }
}

/**
 * Immediately settles only this stream's resource activity. Exact ids keep a
 * late reader from clearing work started by a newer generation in the same chat.
 */
export function clearTrackedResourceActivity(
  tracker: ResourceActivityTracker,
  options: { hardResetActivity: boolean }
): void {
  if (tracker.cleared) return
  const browserStore = useBrowserSessionStore.getState()
  browserStore.clearAgentRunIds(
    [...tracker.browserRunIds],
    options.hardResetActivity ? { hardResetScopeIds: [...tracker.scopeIds] } : undefined
  )

  const terminalStore = useCopilotTerminalStore.getState()
  const terminalToolCallIds = [...tracker.terminalToolCallIds]
  const resetScopeId = tracker.currentScopeId || tracker.scopeIds.values().next().value
  if (resetScopeId) {
    terminalStore.clearAgentCommands(resetScopeId, terminalToolCallIds, options)
  }

  tracker.browserRunIds.clear()
  tracker.terminalToolCallIds.clear()
  tracker.cleared = true
}

/** Settles stale renderer activity when a detached chat hydrates as terminal. */
export function clearResourceActivityScope(scopeId: string): void {
  if (!scopeId) return
  const browserSession = getBrowserSession(scopeId)
  useBrowserSessionStore
    .getState()
    .clearAgentRunIds(browserSession.agentRunIds, { hardResetScopeIds: [scopeId] })

  const terminalSession = getCopilotTerminalSession(scopeId)
  useCopilotTerminalStore
    .getState()
    .clearAgentCommands(scopeId, Object.keys(terminalSession.agentCommandTerminalIds), {
      hardResetActivity: true,
    })
}
