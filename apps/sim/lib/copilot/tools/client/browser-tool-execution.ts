/**
 * Client-side execution of `browser_*` copilot tools.
 *
 * Mirrors the other client-executed tool flows (run-tool, local filesystem):
 * the Go orchestrator emits a client-executed tool call and blocks on Redis;
 * this module performs the action through the desktop app's built-in agent
 * browser and reports the outcome via the confirm endpoint, which wakes the
 * server-side waiter.
 */
import type { BrowserToolName } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { executeBrowserTool } from '@/lib/browser-agent/transport'
import { ASYNC_TOOL_CONFIRMATION_STATUS } from '@/lib/copilot/async-runs/lifecycle'
import { COPILOT_CONFIRM_API_PATH } from '@/lib/copilot/constants'
import { reportClientToolCompletion } from '@/lib/copilot/tools/client/completion'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

const logger = createLogger('CopilotBrowserToolExecution')

const DEFAULT_TOOL_TIMEOUT_MS = 30_000
const NAVIGATION_TOOL_TIMEOUT_MS = 45_000
const WAIT_FOR_TIMEOUT_GRACE_MS = 15_000

/**
 * Tools that can revive a closed browser session by opening a fresh tab.
 * Everything else requires a live page and is rejected up front when the
 * session is closed, instead of burning the full IPC timeout per call — a
 * dead session used to answer every tool with an indistinguishable generic
 * ~30s timeout, which the agent retried indefinitely.
 */
const SESSION_REVIVAL_TOOLS: ReadonlySet<BrowserToolName> = new Set<BrowserToolName>([
  'browser_navigate',
  'browser_open_tab',
  'browser_list_tabs',
])

const SESSION_CLOSED_MESSAGE =
  'The agent browser session is closed, so this browser tool cannot run. ' +
  'Call browser_navigate or browser_open_tab to start a new session, or report the situation to the user. ' +
  'Do not retry other browser tools until a new session is open.'
/** Tool events older than this are replays, not live instructions — never act on them. */
const MAX_EVENT_AGE_MS = 120_000
const EXECUTED_STORAGE_PREFIX = 'sim:copilot:browser-tool-executed:'

/**
 * Exactly-once guard. Stream recovery and tab reloads replay persisted tool
 * events; a browser action must never run twice (re-opening tabs, re-clicking
 * buttons). In-memory set for the fast path, sessionStorage so a reload of the
 * same tab cannot re-execute what it already did.
 */
const executedToolCallIds = new Set<string>()

function hasAlreadyExecuted(toolCallId: string): boolean {
  if (executedToolCallIds.has(toolCallId)) return true
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(`${EXECUTED_STORAGE_PREFIX}${toolCallId}`) !== null
  } catch {
    return false
  }
}

function markExecuted(toolCallId: string): void {
  executedToolCallIds.add(toolCallId)
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(`${EXECUTED_STORAGE_PREFIX}${toolCallId}`, '1')
  } catch {
    // Best-effort; the in-memory set still covers this tab's lifetime.
  }
}

/** Milliseconds since the event was emitted, or null when unparsable. */
function eventAgeMs(eventTs: string | undefined): number | null {
  if (!eventTs) return null
  const emitted = Date.parse(eventTs)
  return Number.isNaN(emitted) ? null : Date.now() - emitted
}

function timeoutForTool(toolName: BrowserToolName, params: Record<string, unknown>): number | null {
  if (toolName === 'browser_request_takeover') return null
  if (
    toolName === 'browser_navigate' ||
    toolName === 'browser_go_back' ||
    toolName === 'browser_go_forward' ||
    toolName === 'browser_open_tab'
  ) {
    return NAVIGATION_TOOL_TIMEOUT_MS
  }
  if (toolName === 'browser_wait_for') {
    const requested = typeof params.timeoutMs === 'number' ? params.timeoutMs : 10_000
    return requested + WAIT_FOR_TIMEOUT_GRACE_MS
  }
  return DEFAULT_TOOL_TIMEOUT_MS
}

/**
 * Tool results feed the model as text; images are not supported on that path
 * yet, so a screenshot's data URL is dropped and the model gets a short
 * factual note instead of half a megabyte of base64.
 */
function sanitizeResultForModel(
  toolName: BrowserToolName,
  result: unknown
): Record<string, unknown> | undefined {
  if (!isRecordLike(result)) {
    return result === undefined ? undefined : { value: result }
  }
  if (toolName === 'browser_screenshot' && typeof result.dataUrl === 'string') {
    const { dataUrl: _dataUrl, ...rest } = result
    return {
      ...rest,
      note: 'Screenshot captured. Visual inspection is not available to you in this build — use browser_snapshot or browser_read_text to inspect content.',
    }
  }
  return result
}

/**
 * Fire-and-forget entry point invoked by the stream tool-event handler when a
 * `browser_*` client tool call arrives.
 *
 * @param eventTs - the stream envelope's emission timestamp; stale events
 * (replays after reconnect/reload) are dropped rather than re-executed.
 */
export function executeBrowserToolOnClient(
  toolCallId: string,
  toolName: BrowserToolName,
  params: Record<string, unknown>,
  eventTs?: string
): void {
  if (hasAlreadyExecuted(toolCallId)) {
    logger.info('Skipping already-executed browser tool (replay)', { toolCallId, toolName })
    return
  }
  const age = eventAgeMs(eventTs)
  if (age !== null && age > MAX_EVENT_AGE_MS) {
    logger.info('Skipping stale browser tool event', { toolCallId, toolName, age })
    return
  }
  markExecuted(toolCallId)
  void doExecuteBrowserTool(toolCallId, toolName, params).catch((err) => {
    logger.error('Unhandled error in client-side browser tool execution', {
      toolCallId,
      toolName,
      error: toError(err).message,
    })
  })
}

/** True when the desktop app has reported the agent browser session closed. */
function isSessionClosed(): boolean {
  return !useBrowserSessionStore.getState().sessionAlive
}

async function doExecuteBrowserTool(
  toolCallId: string,
  toolName: BrowserToolName,
  params: Record<string, unknown>
): Promise<void> {
  if (isSessionClosed() && !SESSION_REVIVAL_TOOLS.has(toolName)) {
    logger.warn('Rejecting browser tool: agent browser session is closed', {
      toolCallId,
      toolName,
    })
    await reportClientToolCompletion(
      toolCallId,
      ASYNC_TOOL_CONFIRMATION_STATUS.error,
      SESSION_CLOSED_MESSAGE,
      { error: SESSION_CLOSED_MESSAGE, sessionClosed: true }
    ).catch((reportErr) => {
      logger.error('Failed to report browser session-closed error', {
        toolCallId,
        error: toError(reportErr).message,
      })
    })
    return
  }
  // If the user leaves the page mid-action the awaited result is lost; tell
  // the waiter so the turn fails fast instead of hanging until its timeout.
  const onPageHide = () => {
    navigator.sendBeacon(
      COPILOT_CONFIRM_API_PATH,
      new Blob(
        [
          JSON.stringify({
            toolCallId,
            status: ASYNC_TOOL_CONFIRMATION_STATUS.error,
            message:
              'The user left the Sim window while this browser action was running, so its result was lost.',
          }),
        ],
        { type: 'application/json' }
      )
    )
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide)
  }

  logger.info('Executing browser tool via the desktop agent browser', { toolCallId, toolName })

  try {
    const result = await executeBrowserTool(
      toolCallId,
      toolName,
      params,
      timeoutForTool(toolName, params)
    )
    await reportClientToolCompletion(
      toolCallId,
      ASYNC_TOOL_CONFIRMATION_STATUS.success,
      'Browser action completed',
      sanitizeResultForModel(toolName, result)
    )
  } catch (err) {
    // The session dying mid-call (e.g. during a takeover) surfaces as a
    // generic timeout; tag it so the model learns the real, terminal cause
    // instead of retrying against a dead session.
    const sessionClosed = isSessionClosed()
    const message = sessionClosed
      ? `${toError(err).message} ${SESSION_CLOSED_MESSAGE}`
      : toError(err).message
    logger.warn('Browser tool failed', { toolCallId, toolName, error: message, sessionClosed })
    await reportClientToolCompletion(toolCallId, ASYNC_TOOL_CONFIRMATION_STATUS.error, message, {
      error: message,
      ...(sessionClosed ? { sessionClosed: true } : {}),
    }).catch((reportErr) => {
      logger.error('Failed to report browser tool error', {
        toolCallId,
        error: toError(reportErr).message,
      })
    })
  } finally {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide)
    }
  }
}
