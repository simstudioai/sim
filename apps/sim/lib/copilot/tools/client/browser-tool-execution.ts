/**
 * Client-side execution of `browser_*` copilot tools.
 *
 * Mirrors the other client-executed tool flows (run-tool, local filesystem):
 * the Go orchestrator emits a client-executed tool call and blocks on Redis;
 * this module performs the action through the desktop app's built-in agent
 * browser and reports the outcome via the confirm endpoint, which wakes the
 * server-side waiter.
 */
import {
  BROWSER_WAIT_FOR_RENDERER_GRACE_MS,
  type BrowserToolName,
  normalizeBrowserWaitForTimeoutMs,
} from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import {
  cancelBrowserTool,
  executeBrowserTool,
  restoreBrowserScope,
} from '@/lib/browser-agent/transport'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncCompletionData,
  type AsyncConfirmationStatus,
} from '@/lib/copilot/async-runs/lifecycle'
import { COPILOT_CONFIRM_API_PATH } from '@/lib/copilot/constants'
import {
  reportClientToolCompletion,
  reportClientToolCompletionOnPageExit,
} from '@/lib/copilot/tools/client/completion'
import { getBrowserSession, useBrowserSessionStore } from '@/stores/browser-session/store'

const logger = createLogger('CopilotBrowserToolExecution')

const DEFAULT_TOOL_TIMEOUT_MS = 30_000
const NAVIGATION_TOOL_TIMEOUT_MS = 45_000

/**
 * Tools that do not require an existing live page. Most create a new page;
 * `browser_list_sessions` reads the desktop's profile-level session registry.
 * Everything else is rejected up front when a closed scope cannot be restored,
 * instead of burning the full IPC timeout per call.
 */
const LIVE_PAGE_OPTIONAL_TOOLS: ReadonlySet<BrowserToolName> = new Set<BrowserToolName>([
  'browser_navigate',
  'browser_open_url',
  'browser_open_tab',
  'browser_list_tabs',
  'browser_list_sessions',
])

const SESSION_CLOSED_MESSAGE =
  'The agent browser session is closed, so this browser tool cannot run. ' +
  'Call browser_navigate or browser_open_tab to start a new session, or report the situation to the user. ' +
  'Do not retry other browser tools until a new session is open.'
/** Tool events older than this are replays, not live instructions — never act on them. */
const MAX_EVENT_AGE_MS = 120_000
const EXECUTED_STORAGE_PREFIX = 'sim:copilot:browser-tool-executed:'
const PAGE_EXIT_COMPLETION_MAX_BYTES = 48 * 1024
const OUTCOME_UNKNOWN_MESSAGE =
  'The Sim window closed while this browser action was in flight. It may already have taken effect. Do not retry it automatically; take a fresh browser snapshot before deciding what to do.'

interface PendingTerminalCompletion {
  status: AsyncConfirmationStatus
  message: string
  data?: AsyncCompletionData
}

function compactCompletionForPageExit(
  toolCallId: string,
  completion: PendingTerminalCompletion
): PendingTerminalCompletion {
  const serialized = JSON.stringify({ toolCallId, ...completion })
  if (new Blob([serialized]).size <= PAGE_EXIT_COMPLETION_MAX_BYTES) return completion

  const data = isRecordLike(completion.data) ? completion.data : {}
  return {
    status: completion.status,
    message: truncate(completion.message, 1024),
    data: {
      ...(data.outcomeUnknown === true ? { outcomeUnknown: true } : {}),
      ...(data.doNotRetry === true ? { doNotRetry: true } : {}),
      ...(data.sessionClosed === true ? { sessionClosed: true } : {}),
      resultOmittedDuringPageExit: true,
      note: 'The browser action reached a known terminal state, but its full result was too large for unload-safe delivery. Do not repeat a side-effecting action. Take a fresh browser snapshot to recover current page state.',
    },
  }
}

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

function isOutcomeUnknownError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'outcomeUnknown' in error &&
    error.outcomeUnknown === true
  )
}

function timeoutForTool(toolName: BrowserToolName, params: Record<string, unknown>): number | null {
  if (toolName === 'browser_request_takeover') return null
  if (
    toolName === 'browser_navigate' ||
    toolName === 'browser_open_url' ||
    toolName === 'browser_go_back' ||
    toolName === 'browser_go_forward' ||
    toolName === 'browser_open_tab'
  ) {
    return NAVIGATION_TOOL_TIMEOUT_MS
  }
  if (toolName === 'browser_wait_for') {
    const requested = normalizeBrowserWaitForTimeoutMs(params.timeoutMs)
    return requested + BROWSER_WAIT_FOR_RENDERER_GRACE_MS
  }
  return DEFAULT_TOOL_TIMEOUT_MS
}

/** Splits a `data:<media type>;base64,<data>` URL into its parts. */
function parseBase64DataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl)
  if (!match) return null
  return { mediaType: match[1], data: match[2] }
}

/**
 * Reshapes a screenshot into the `attachment` contract the copilot serializes
 * into a real image content block, so the model sees the page rather than a
 * note about it. The data URL itself never goes inline: `content` is the text
 * the model reads beside the image, and the bytes travel under `attachment`.
 *
 * A malformed data URL degrades to the text note rather than shipping an
 * attachment the provider would reject.
 */
function sanitizeResultForModel(
  toolName: BrowserToolName,
  result: unknown
): Record<string, unknown> | undefined {
  if (!isRecordLike(result)) {
    return result === undefined ? undefined : { value: result }
  }
  if (toolName === 'browser_screenshot' && typeof result.dataUrl === 'string') {
    const { dataUrl, ...rest } = result
    const image = parseBase64DataUrl(dataUrl)
    if (!image) {
      return {
        ...rest,
        note: 'The screenshot could not be encoded. Use browser_snapshot or browser_read_text instead.',
      }
    }
    const location = typeof rest.url === 'string' && rest.url ? ` of ${rest.url}` : ''
    return {
      ...rest,
      content: `Screenshot${location}. This is the rendered viewport only — it carries no element ids, so use browser_snapshot before interacting.`,
      attachment: {
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.data },
      },
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
  scopeId = useBrowserSessionStore.getState().activeScopeId,
  eventTs?: string,
  abortSignal?: AbortSignal
): void {
  if (!scopeId) {
    logger.error('Cannot execute browser tool without a chat scope', { toolCallId, toolName })
    // Tell the waiter, or the turn hangs forever on a tool that never ran.
    const message = 'This browser action could not run: no active browser session for this chat.'
    void reportClientToolCompletion(toolCallId, ASYNC_TOOL_CONFIRMATION_STATUS.error, message, {
      error: message,
    }).catch((reportErr) => {
      logger.error('Failed to report missing-scope browser tool error', {
        toolCallId,
        error: toError(reportErr).message,
      })
    })
    return
  }
  if (hasAlreadyExecuted(toolCallId)) {
    // Same-page re-delivery: the original dispatch is in flight (or done) and
    // owns the result. Reporting here would race it — the server claims each
    // resume exactly once, so an error now would discard the genuine result.
    logger.info('Skipping already-executed browser tool (replay)', { toolCallId, toolName })
    return
  }
  const age = eventAgeMs(eventTs)
  if (age !== null && age > MAX_EVENT_AGE_MS) {
    logger.info('Skipping stale browser tool event', { toolCallId, toolName, age })
    // Usually a replay of an action that already ran and resumed in a previous
    // page lifetime — the server claims each resume exactly once, so this
    // duplicate confirmation is simply discarded. When it is NOT a replay
    // (the event was delivered late, e.g. a backgrounded tab with throttled
    // timers), this error unblocks the turn instead of leaving it hanging
    // forever on a tool that will never execute.
    const message =
      'This browser action was delivered too late to run safely. Ask again to retry it.'
    void reportClientToolCompletion(toolCallId, ASYNC_TOOL_CONFIRMATION_STATUS.error, message, {
      error: message,
      staleEvent: true,
    }).catch((reportErr) => {
      logger.error('Failed to report stale browser tool error', {
        toolCallId,
        error: toError(reportErr).message,
      })
    })
    return
  }
  markExecuted(toolCallId)
  void doExecuteBrowserTool(toolCallId, toolName, params, scopeId, abortSignal).catch((err) => {
    logger.error('Unhandled error in client-side browser tool execution', {
      toolCallId,
      toolName,
      error: toError(err).message,
    })
  })
}

/** True when the desktop app has reported the agent browser session closed. */
function isSessionClosed(scopeId: string): boolean {
  return !getBrowserSession(scopeId).sessionAlive
}

async function doExecuteBrowserTool(
  toolCallId: string,
  toolName: BrowserToolName,
  params: Record<string, unknown>,
  scopeId: string,
  abortSignal?: AbortSignal
): Promise<void> {
  let cancelled = abortSignal?.aborted === true
  let nativeActionPending = true
  let nativeDispatchStarted = false
  let pendingTerminalCompletion: PendingTerminalCompletion | null = null
  const reportTerminalCompletion = async (
    completion: PendingTerminalCompletion,
    failureLog: string
  ): Promise<void> => {
    pendingTerminalCompletion = completion
    try {
      await reportClientToolCompletion(
        toolCallId,
        completion.status,
        completion.message,
        completion.data
      )
      pendingTerminalCompletion = null
    } catch (error) {
      logger.error(failureLog, {
        toolCallId,
        error: toError(error).message,
      })
      const compactCompletion = compactCompletionForPageExit(toolCallId, completion)
      try {
        await reportClientToolCompletionOnPageExit(
          toolCallId,
          compactCompletion.status,
          compactCompletion.message,
          compactCompletion.data
        )
        pendingTerminalCompletion = null
      } catch (fallbackError) {
        logger.error('Failed to enqueue browser completion with unload-safe fallback', {
          toolCallId,
          error: toError(fallbackError).message,
        })
      }
    }
  }
  const cancelNativeTool = async () => {
    cancelled = true
    try {
      await cancelBrowserTool(toolCallId, scopeId, toolName)
    } catch (error) {
      logger.warn('Could not cancel native browser tool', {
        toolCallId,
        toolName,
        error: toError(error).message,
      })
    }
  }
  const onAbort = () => {
    if (!nativeActionPending) return
    void cancelNativeTool()
  }
  const onPageHide = () => {
    if (cancelled) return
    const pendingCompletion =
      pendingTerminalCompletion ??
      (() => {
        if (!nativeActionPending) return null
        const message = nativeDispatchStarted
          ? OUTCOME_UNKNOWN_MESSAGE
          : 'The Sim window closed before this browser action started. Its result was lost.'
        return {
          status: ASYNC_TOOL_CONFIRMATION_STATUS.error,
          message,
          data: {
            error: message,
            outcomeUnknown: nativeDispatchStarted,
            doNotRetry: nativeDispatchStarted,
          },
        }
      })()
    if (!pendingCompletion) return
    const completion = compactCompletionForPageExit(toolCallId, pendingCompletion)
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide)
    }
    const reportFallback = () => {
      void reportClientToolCompletionOnPageExit(
        toolCallId,
        completion.status,
        completion.message,
        completion.data
      ).catch((error) => {
        logger.error('Failed to report browser page-exit completion fallback', {
          toolCallId,
          toolName,
          error: toError(error).message,
        })
      })
    }
    if (nativeActionPending) {
      void cancelNativeTool()
    }
    try {
      const accepted = navigator.sendBeacon(
        COPILOT_CONFIRM_API_PATH,
        new Blob(
          [
            JSON.stringify({
              toolCallId,
              status: completion.status,
              message: completion.message,
              ...(completion.data !== undefined ? { data: completion.data } : {}),
            }),
          ],
          { type: 'application/json' }
        )
      )
      if (!accepted) {
        logger.warn('Browser page-exit completion beacon was not accepted', {
          toolCallId,
          toolName,
        })
        reportFallback()
      }
    } catch (error) {
      logger.warn('Browser page-exit completion beacon failed', {
        toolCallId,
        toolName,
        error: toError(error).message,
      })
      reportFallback()
    }
  }
  if (cancelled) {
    void cancelNativeTool()
  } else {
    abortSignal?.addEventListener('abort', onAbort, { once: true })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide)
  }

  try {
    const needsLivePage = !LIVE_PAGE_OPTIONAL_TOOLS.has(toolName)
    if (needsLivePage && isSessionClosed(scopeId)) {
      try {
        await restoreBrowserScope(scopeId)
      } catch (err) {
        logger.warn('Could not restore the scoped browser session before tool execution', {
          toolCallId,
          toolName,
          error: toError(err).message,
        })
      }
    }
    if (needsLivePage && isSessionClosed(scopeId)) {
      nativeActionPending = false
      logger.warn('Rejecting browser tool: agent browser session is closed', {
        toolCallId,
        toolName,
      })
      if (cancelled) return
      await reportTerminalCompletion(
        {
          status: ASYNC_TOOL_CONFIRMATION_STATUS.error,
          message: SESSION_CLOSED_MESSAGE,
          data: { error: SESSION_CLOSED_MESSAGE, sessionClosed: true },
        },
        'Failed to report browser session-closed error'
      )
      return
    }

    if (cancelled) return

    logger.info('Executing browser tool via the desktop agent browser', { toolCallId, toolName })

    let result: unknown
    try {
      nativeDispatchStarted = true
      result = await executeBrowserTool(
        toolCallId,
        toolName,
        params,
        timeoutForTool(toolName, params),
        scopeId,
        () => {
          cancelled = true
        }
      )
    } catch (err) {
      nativeActionPending = false
      if (cancelled) return
      const sessionClosed = isSessionClosed(scopeId)
      const outcomeUnknown = isOutcomeUnknownError(err)
      const message = sessionClosed
        ? `${toError(err).message} ${SESSION_CLOSED_MESSAGE}`
        : toError(err).message
      logger.warn('Browser tool failed', { toolCallId, toolName, error: message, sessionClosed })
      await reportTerminalCompletion(
        {
          status: ASYNC_TOOL_CONFIRMATION_STATUS.error,
          message,
          data: {
            error: message,
            ...(outcomeUnknown ? { outcomeUnknown: true, doNotRetry: true } : {}),
            ...(sessionClosed ? { sessionClosed: true } : {}),
          },
        },
        'Failed to report browser tool error'
      )
      return
    }
    nativeActionPending = false
    if (cancelled) return
    await reportTerminalCompletion(
      {
        status: ASYNC_TOOL_CONFIRMATION_STATUS.success,
        message: 'Browser action completed',
        data: sanitizeResultForModel(toolName, result),
      },
      'Failed to report successful browser tool completion'
    )
  } finally {
    abortSignal?.removeEventListener('abort', onAbort)
    if (typeof window !== 'undefined' && !pendingTerminalCompletion) {
      window.removeEventListener('pagehide', onPageHide)
    }
  }
}
