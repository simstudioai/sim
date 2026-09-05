/**
 * Client-side execution of `browser_*` copilot tools.
 *
 * Mirrors the other client-executed tool flows (run-tool, local filesystem):
 * the Go orchestrator emits a client-executed tool call and blocks on Redis;
 * this module performs the action through the desktop app's built-in agent
 * browser and reports the outcome via the confirm endpoint, which wakes the
 * server-side waiter.
 */
import { type BrowserToolName, browserToolRendererTimeoutMs } from '@sim/browser-protocol'
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
import { BrowserToolReplayLedger } from '@/lib/copilot/tools/client/browser-tool-replay-ledger'
import {
  reportClientToolCompletion,
  reportClientToolCompletionOnPageExit,
} from '@/lib/copilot/tools/client/completion'
import { getBrowserSession, useBrowserSessionStore } from '@/stores/browser-session/store'

const logger = createLogger('CopilotBrowserToolExecution')

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
  'browser_list_downloads',
])

/**
 * Exhaustive replay policy for browser tools. Observation-only calls may run
 * when durable replay storage is unavailable because repeating them after a
 * reload cannot cause a page or external side effect. Every stateful current
 * tool and the retired takeover flow remain fail-closed.
 */
const OBSERVATION_ONLY_BROWSER_TOOLS = {
  browser_navigate: false,
  browser_open_url: false,
  browser_go_back: false,
  browser_go_forward: false,
  browser_reload: false,
  browser_open_tab: false,
  browser_switch_tab: false,
  browser_close_tab: false,
  browser_list_tabs: true,
  browser_list_sessions: true,
  browser_list_downloads: true,
  browser_wait_for: true,
  browser_snapshot: true,
  browser_find: true,
  browser_read_text: true,
  browser_screenshot: true,
  browser_extract: true,
  browser_click: false,
  browser_click_at: false,
  browser_type: false,
  browser_insert_text: false,
  browser_press_key: false,
  browser_scroll: false,
  browser_select_option: false,
  browser_set_checked: false,
  browser_hover: false,
  browser_drag: false,
  browser_zoom: false,
  browser_request_takeover: false,
} as const satisfies Readonly<Record<BrowserToolName, boolean>>

const SESSION_CLOSED_MESSAGE =
  'The agent browser session is closed, so this browser tool cannot run. ' +
  'Call browser_navigate or browser_open_tab to start a new session, or report the situation to the user. ' +
  'Do not retry other browser tools until a new session is open.'
/** Tool events older than this are replays, not live instructions — never act on them. */
const MAX_EVENT_AGE_MS = 120_000
const EXECUTED_STORAGE_PREFIX = 'sim:copilot:browser-tool-executed:'
const EXECUTED_LEDGER_STORAGE_KEY = 'sim:copilot:browser-tool-executed-ledger:v1'
const EXECUTED_LEDGER_MAX_ENTRIES = 2_048
const EXECUTED_LEDGER_TTL_MS = 5 * 60_000
const PAGE_EXIT_COMPLETION_MAX_BYTES = 48 * 1024
const RETAINED_COMPLETION_MAX_BYTES = 8 * 1024
const TERMINAL_COMPLETION_MAX_ACTIVE = 4
const TERMINAL_COMPLETION_MAX_QUEUED = 64
const OUTCOME_UNKNOWN_MESSAGE =
  'The Sim window closed while this browser action was in flight. It may already have taken effect. Do not retry it automatically; take a fresh browser snapshot before deciding what to do.'
const REPLAY_OUTCOME_UNKNOWN_MESSAGE =
  'This browser action was recorded before the Sim page reloaded, but its terminal result could not be recovered. It may already have taken effect. Do not retry it automatically; take a fresh browser snapshot before deciding what to do.'
const STALE_STATEFUL_OUTCOME_UNKNOWN_MESSAGE =
  'This browser action was delivered too late to recover its exact result. It may already have taken effect. Do not retry it automatically; take a fresh browser snapshot before deciding what to do.'
const REPLAY_GUARD_CAPACITY_MESSAGE =
  'This browser action could not run safely because the recent-action replay guard is full. Wait a few minutes, then ask again.'
const REPLAY_GUARD_STORAGE_MESSAGE =
  'This browser action could not run safely because reload-safe replay protection is unavailable. Check that browser storage is enabled, then ask again.'

interface PendingTerminalCompletion {
  status: AsyncConfirmationStatus
  message: string
  data?: AsyncCompletionData
}

type TerminalCompletionPriority = 'executed' | 'guard'

interface RetainedTerminalCompletion {
  completion?: PendingTerminalCompletion
  lastSeenAt: number
  deliveryState:
    | 'reserved'
    | 'pending'
    | 'queued'
    | 'in-flight'
    | 'awaiting-redelivery'
    | 'delivered'
  priority: TerminalCompletionPriority
  failureLog: string
  onPendingChange?: (completion: PendingTerminalCompletion | null) => void
  onRelease?: () => void
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

function compactCompletionForRetry(
  toolCallId: string,
  completion: PendingTerminalCompletion
): PendingTerminalCompletion {
  const serialized = JSON.stringify({ toolCallId, ...completion })
  if (new Blob([serialized]).size <= RETAINED_COMPLETION_MAX_BYTES) return completion

  const data = isRecordLike(completion.data) ? completion.data : {}
  return {
    status: completion.status,
    message: truncate(completion.message, 1024),
    data: {
      ...(data.outcomeUnknown === true ? { outcomeUnknown: true } : {}),
      ...(data.doNotRetry === true ? { doNotRetry: true } : {}),
      ...(data.sessionClosed === true ? { sessionClosed: true } : {}),
      resultOmittedDuringRecovery: true,
      note: 'The browser action reached a known terminal state, but its full result was too large to retain for delivery recovery. Do not repeat a side-effecting action. Take a fresh browser snapshot to recover current page state.',
    },
  }
}

async function deliverTerminalCompletion(
  toolCallId: string,
  completion: PendingTerminalCompletion,
  failureLog: string,
  onPendingChange?: (completion: PendingTerminalCompletion | null) => void
): Promise<boolean> {
  onPendingChange?.(completion)
  try {
    await reportClientToolCompletion(
      toolCallId,
      completion.status,
      completion.message,
      completion.data
    )
    onPendingChange?.(null)
    return true
  } catch (error) {
    logger.error(failureLog, {
      toolCallId,
      error: toError(error).message,
    })
  }

  const compactCompletion = compactCompletionForPageExit(toolCallId, completion)
  onPendingChange?.(compactCompletion)
  try {
    await reportClientToolCompletionOnPageExit(
      toolCallId,
      compactCompletion.status,
      compactCompletion.message,
      compactCompletion.data
    )
    onPendingChange?.(null)
    return true
  } catch (fallbackError) {
    logger.error('Failed to enqueue browser completion with unload-safe fallback', {
      toolCallId,
      error: toError(fallbackError).message,
    })
    return false
  }
}

/**
 * Exactly-once guard for stream recovery and renderer reloads. The ledger is
 * bounded while refusing to evict anything inside the full accepted-event
 * window, so capacity pressure fails closed instead of making an action
 * replayable.
 */
const executedToolCalls = new BrowserToolReplayLedger({
  storageKey: EXECUTED_LEDGER_STORAGE_KEY,
  legacyStoragePrefix: EXECUTED_STORAGE_PREFIX,
  maxEntries: EXECUTED_LEDGER_MAX_ENTRIES,
  ttlMs: EXECUTED_LEDGER_TTL_MS,
  protectedWindowMs: MAX_EVENT_AGE_MS,
})

const retainedTerminalCompletions = new Map<string, RetainedTerminalCompletion>()
/** Distinguishes a same-runtime redelivery from a durable claim recovered after reload. */
const runningBrowserToolCalls = new Set<string>()
const terminalCompletionQueues: Record<TerminalCompletionPriority, string[]> = {
  executed: [],
  guard: [],
}
let activeTerminalCompletionDeliveries = 0

function removeFromTerminalCompletionQueues(toolCallId: string): void {
  for (const priority of ['executed', 'guard'] as const) {
    const index = terminalCompletionQueues[priority].indexOf(toolCallId)
    if (index >= 0) terminalCompletionQueues[priority].splice(index, 1)
  }
}

function releaseRetainedTerminalCompletion(entry: RetainedTerminalCompletion): void {
  entry.completion = undefined
  entry.onPendingChange?.(null)
  entry.onPendingChange = undefined
  entry.onRelease?.()
  entry.onRelease = undefined
}

function deleteRetainedTerminalCompletion(
  toolCallId: string,
  entry: RetainedTerminalCompletion
): void {
  removeFromTerminalCompletionQueues(toolCallId)
  releaseRetainedTerminalCompletion(entry)
  retainedTerminalCompletions.delete(toolCallId)
}

function pruneRetainedTerminalCompletions(now: number): void {
  for (const [toolCallId, entry] of retainedTerminalCompletions) {
    if (entry.deliveryState === 'in-flight') continue
    if (now - entry.lastSeenAt <= EXECUTED_LEDGER_TTL_MS) continue
    if (entry.priority === 'executed' && entry.deliveryState !== 'delivered') continue
    deleteRetainedTerminalCompletion(toolCallId, entry)
  }
}

function retryRetainedTerminalCompletion(toolCallId: string): boolean {
  const entry = retainedTerminalCompletions.get(toolCallId)
  if (!entry) return false
  const now = Date.now()
  if (entry.deliveryState === 'in-flight') {
    entry.lastSeenAt = now
    retainedTerminalCompletions.delete(toolCallId)
    retainedTerminalCompletions.set(toolCallId, entry)
    return true
  }
  const preserveUndeliveredResult =
    entry.priority === 'executed' && entry.deliveryState !== 'delivered'
  if (now - entry.lastSeenAt > EXECUTED_LEDGER_TTL_MS && !preserveUndeliveredResult) {
    deleteRetainedTerminalCompletion(toolCallId, entry)
    return false
  }
  entry.lastSeenAt = now
  retainedTerminalCompletions.delete(toolCallId)
  retainedTerminalCompletions.set(toolCallId, entry)
  if (entry.deliveryState === 'reserved') return true
  if (entry.deliveryState === 'awaiting-redelivery') entry.deliveryState = 'pending'
  scheduleTerminalCompletion(toolCallId)
  return true
}

function terminalCompletionQueueSize(): number {
  return terminalCompletionQueues.executed.length + terminalCompletionQueues.guard.length
}

function enqueueTerminalCompletion(toolCallId: string, entry: RetainedTerminalCompletion): boolean {
  if (entry.deliveryState !== 'pending') return false
  if (terminalCompletionQueueSize() >= TERMINAL_COMPLETION_MAX_QUEUED) {
    if (entry.priority !== 'executed') return false
    const displacedToolCallId = terminalCompletionQueues.guard.shift()
    if (!displacedToolCallId) return false
    const displacedEntry = retainedTerminalCompletions.get(displacedToolCallId)
    if (displacedEntry?.deliveryState === 'queued') displacedEntry.deliveryState = 'pending'
  }
  terminalCompletionQueues[entry.priority].push(toolCallId)
  entry.deliveryState = 'queued'
  return true
}

function refillTerminalCompletionQueues(): void {
  for (const priority of ['executed', 'guard'] as const) {
    for (const [toolCallId, entry] of retainedTerminalCompletions) {
      if (entry.priority === priority && entry.deliveryState === 'pending') {
        const enqueued = enqueueTerminalCompletion(toolCallId, entry)
        if (!enqueued && priority === 'guard') return
      }
    }
  }
}

function startTerminalCompletionDelivery(
  toolCallId: string,
  entry: RetainedTerminalCompletion,
  completion: PendingTerminalCompletion
): void {
  entry.deliveryState = 'in-flight'
  activeTerminalCompletionDeliveries += 1
  entry.onPendingChange?.(completion)
  void deliverTerminalCompletion(toolCallId, completion, entry.failureLog, (pending) =>
    entry.onPendingChange?.(pending)
  )
    .then((delivered) => {
      if (retainedTerminalCompletions.get(toolCallId) === entry) {
        if (delivered) {
          entry.deliveryState = 'delivered'
          releaseRetainedTerminalCompletion(entry)
        } else {
          entry.deliveryState = 'awaiting-redelivery'
          entry.onPendingChange?.(entry.completion ?? null)
        }
      }
    })
    .catch((error) => {
      logger.error('Unexpected browser terminal-completion delivery failure', {
        toolCallId,
        error: toError(error).message,
      })
      if (retainedTerminalCompletions.get(toolCallId) === entry) {
        entry.deliveryState = 'awaiting-redelivery'
        entry.onPendingChange?.(entry.completion ?? null)
      }
    })
    .finally(() => {
      activeTerminalCompletionDeliveries -= 1
      drainTerminalCompletionQueue()
    })
}

function drainTerminalCompletionQueue(): void {
  refillTerminalCompletionQueues()
  while (activeTerminalCompletionDeliveries < TERMINAL_COMPLETION_MAX_ACTIVE) {
    const toolCallId =
      terminalCompletionQueues.executed.shift() ?? terminalCompletionQueues.guard.shift()
    if (!toolCallId) return
    const entry = retainedTerminalCompletions.get(toolCallId)
    if (!entry || entry.deliveryState !== 'queued' || !entry.completion) continue
    startTerminalCompletionDelivery(toolCallId, entry, entry.completion)
  }
}

function hasPendingExecutedTerminalCompletion(): boolean {
  if (terminalCompletionQueues.executed.length > 0) return true
  for (const entry of retainedTerminalCompletions.values()) {
    if (entry.priority === 'executed' && entry.deliveryState === 'pending') return true
  }
  return false
}

function scheduleTerminalCompletion(
  toolCallId: string,
  initialCompletion?: PendingTerminalCompletion
): void {
  const entry = retainedTerminalCompletions.get(toolCallId)
  if (!entry || entry.deliveryState !== 'pending' || !entry.completion) return

  const hasExecutedAhead = hasPendingExecutedTerminalCompletion()
  if (
    activeTerminalCompletionDeliveries < TERMINAL_COMPLETION_MAX_ACTIVE &&
    (entry.priority === 'executed' || !hasExecutedAhead)
  ) {
    startTerminalCompletionDelivery(toolCallId, entry, initialCompletion ?? entry.completion)
    return
  }

  enqueueTerminalCompletion(toolCallId, entry)
  drainTerminalCompletionQueue()
}

/** Never sacrifices an undelivered result from a browser action to admit overflow work. */
function selectRetainedCompletionForEviction(): [string, RetainedTerminalCompletion] | undefined {
  for (const candidate of retainedTerminalCompletions) {
    if (candidate[1].deliveryState === 'delivered') return candidate
  }
  for (const candidate of retainedTerminalCompletions) {
    if (candidate[1].priority === 'guard' && candidate[1].deliveryState !== 'in-flight') {
      return candidate
    }
  }
  return undefined
}

function reserveTerminalCompletion(
  toolCallId: string,
  priority: TerminalCompletionPriority,
  failureLog: string,
  onPendingChange?: (completion: PendingTerminalCompletion | null) => void,
  onRelease?: () => void
): RetainedTerminalCompletion | null {
  const now = Date.now()
  pruneRetainedTerminalCompletions(now)
  if (retainedTerminalCompletions.has(toolCallId)) return null
  if (retainedTerminalCompletions.size >= EXECUTED_LEDGER_MAX_ENTRIES) {
    const candidate = selectRetainedCompletionForEviction()
    if (!candidate) {
      logger.error('Browser terminal-completion retention is full', {
        toolCallId,
        priority,
      })
      onPendingChange?.(null)
      onRelease?.()
      return null
    }
    deleteRetainedTerminalCompletion(candidate[0], candidate[1])
  }
  const entry: RetainedTerminalCompletion = {
    lastSeenAt: now,
    deliveryState: 'reserved',
    priority,
    failureLog,
    onPendingChange,
    onRelease,
  }
  retainedTerminalCompletions.set(toolCallId, entry)
  return entry
}

function completeTerminalCompletionReservation(
  toolCallId: string,
  entry: RetainedTerminalCompletion,
  completion: PendingTerminalCompletion,
  priority: TerminalCompletionPriority,
  failureLog: string
): RetainedTerminalCompletion | null {
  if (retainedTerminalCompletions.get(toolCallId) !== entry || entry.deliveryState !== 'reserved') {
    return null
  }
  entry.completion = compactCompletionForRetry(toolCallId, completion)
  entry.lastSeenAt = Date.now()
  entry.deliveryState = 'pending'
  entry.priority = priority
  entry.failureLog = failureLog
  retainedTerminalCompletions.delete(toolCallId)
  retainedTerminalCompletions.set(toolCallId, entry)
  entry.onPendingChange?.(entry.completion ?? null)
  return entry
}

function retainTerminalCompletion(
  toolCallId: string,
  completion: PendingTerminalCompletion,
  priority: TerminalCompletionPriority,
  failureLog: string,
  onPendingChange?: (completion: PendingTerminalCompletion | null) => void,
  onRelease?: () => void
): RetainedTerminalCompletion | null {
  const entry = reserveTerminalCompletion(
    toolCallId,
    priority,
    failureLog,
    onPendingChange,
    onRelease
  )
  if (!entry) return null
  return completeTerminalCompletionReservation(toolCallId, entry, completion, priority, failureLog)
}

function completeAndReportTerminalCompletionReservation(
  toolCallId: string,
  entry: RetainedTerminalCompletion,
  completion: PendingTerminalCompletion,
  priority: TerminalCompletionPriority,
  failureLog: string
): void {
  const retained = completeTerminalCompletionReservation(
    toolCallId,
    entry,
    completion,
    priority,
    failureLog
  )
  if (!retained) return
  scheduleTerminalCompletion(toolCallId, completion)
}

function retainAndReportTerminalCompletion(
  toolCallId: string,
  completion: PendingTerminalCompletion,
  failureLog: string
): void {
  const retained = retainTerminalCompletion(toolCallId, completion, 'guard', failureLog)
  if (!retained) return
  scheduleTerminalCompletion(toolCallId, completion)
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
  return browserToolRendererTimeoutMs(toolName, params)
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
    const viewport = isRecordLike(rest.viewport) ? rest.viewport : null
    const screenshotUrl =
      typeof rest.url === 'string' && rest.url
        ? rest.url
        : viewport && typeof viewport.url === 'string'
          ? viewport.url
          : ''
    const location = screenshotUrl ? ` of ${screenshotUrl}` : ''
    const isElementCapture = isRecordLike(rest.clip)
    return {
      ...rest,
      content: `Screenshot${location}. This is the rendered ${isElementCapture ? 'element' : 'viewport'} only — it carries no element ids, so use browser_snapshot before interacting.${isElementCapture ? ' For coordinate actions: cssX = clip.x + imageX / scale; cssY = clip.y + imageY / scale.' : ''}`,
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
  if (retryRetainedTerminalCompletion(toolCallId)) {
    logger.info('Suppressing browser tool while recovering its terminal completion', {
      toolCallId,
      toolName,
    })
    return
  }
  if (!scopeId) {
    logger.error('Cannot execute browser tool without a chat scope', { toolCallId, toolName })
    // Tell the waiter, or the turn hangs forever on a tool that never ran.
    const message = 'This browser action could not run: no active browser session for this chat.'
    retainAndReportTerminalCompletion(
      toolCallId,
      {
        status: ASYNC_TOOL_CONFIRMATION_STATUS.error,
        message,
        data: { error: message },
      },
      'Failed to report missing-scope browser tool error'
    )
    return
  }
  const age = eventAgeMs(eventTs)
  if (age !== null && age > MAX_EVENT_AGE_MS) {
    logger.info('Skipping stale browser tool event', { toolCallId, toolName, age })
    const observationOnly = OBSERVATION_ONLY_BROWSER_TOOLS[toolName]
    const message = observationOnly
      ? 'This browser observation was delivered too late to run safely. Ask again to retry it.'
      : STALE_STATEFUL_OUTCOME_UNKNOWN_MESSAGE
    retainAndReportTerminalCompletion(
      toolCallId,
      {
        status: ASYNC_TOOL_CONFIRMATION_STATUS.error,
        message,
        data: {
          error: message,
          staleEvent: true,
          ...(!observationOnly ? { outcomeUnknown: true, doNotRetry: true } : {}),
        },
      },
      'Failed to report stale browser tool error'
    )
    return
  }
  const completionReservation = reserveTerminalCompletion(
    toolCallId,
    'executed',
    'Failed to report browser tool completion'
  )
  if (!completionReservation) {
    logger.error('Rejecting browser tool before dispatch because result retention is full', {
      toolCallId,
      toolName,
    })
    return
  }
  const reportGuardCompletion = (
    completion: PendingTerminalCompletion,
    failureLog: string
  ): void => {
    completeAndReportTerminalCompletionReservation(
      toolCallId,
      completionReservation,
      completion,
      'guard',
      failureLog
    )
  }
  const replayClaim = executedToolCalls.claim(toolCallId)
  if (replayClaim === 'duplicate') {
    if (runningBrowserToolCalls.has(toolCallId)) {
      deleteRetainedTerminalCompletion(toolCallId, completionReservation)
      logger.info('Skipping in-flight browser tool replay', { toolCallId, toolName })
      return
    }
    logger.warn('Recovering browser tool replay without a local result owner', {
      toolCallId,
      toolName,
    })
    reportGuardCompletion(
      {
        status: ASYNC_TOOL_CONFIRMATION_STATUS.error,
        message: REPLAY_OUTCOME_UNKNOWN_MESSAGE,
        data: {
          error: REPLAY_OUTCOME_UNKNOWN_MESSAGE,
          outcomeUnknown: true,
          doNotRetry: true,
          replayRecoveredWithoutResult: true,
        },
      },
      'Failed to report browser replay with an unknown outcome'
    )
    return
  }
  if (replayClaim === 'capacity-exhausted') {
    logger.error('Rejecting browser tool because the replay guard is full', {
      toolCallId,
      toolName,
    })
    reportGuardCompletion(
      {
        status: ASYNC_TOOL_CONFIRMATION_STATUS.error,
        message: REPLAY_GUARD_CAPACITY_MESSAGE,
        data: {
          error: REPLAY_GUARD_CAPACITY_MESSAGE,
          replayGuardCapacityExceeded: true,
        },
      },
      'Failed to report replay-guard capacity error'
    )
    return
  }
  if (replayClaim === 'storage-unavailable') {
    if (OBSERVATION_ONLY_BROWSER_TOOLS[toolName]) {
      logger.warn('Executing observation-only browser tool without durable replay protection', {
        toolCallId,
        toolName,
      })
    } else {
      logger.error('Rejecting browser tool because durable replay protection is unavailable', {
        toolCallId,
        toolName,
      })
      reportGuardCompletion(
        {
          status: ASYNC_TOOL_CONFIRMATION_STATUS.error,
          message: REPLAY_GUARD_STORAGE_MESSAGE,
          data: {
            error: REPLAY_GUARD_STORAGE_MESSAGE,
            replayGuardStorageUnavailable: true,
          },
        },
        'Failed to report replay-guard storage error'
      )
      return
    }
  }
  runningBrowserToolCalls.add(toolCallId)
  void doExecuteBrowserTool(
    toolCallId,
    toolName,
    params,
    scopeId,
    completionReservation,
    abortSignal
  )
    .catch((err) => {
      logger.error('Unhandled error in client-side browser tool execution', {
        toolCallId,
        toolName,
        error: toError(err).message,
      })
    })
    .finally(() => {
      runningBrowserToolCalls.delete(toolCallId)
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
  completionReservation: RetainedTerminalCompletion,
  abortSignal?: AbortSignal
): Promise<void> {
  let cancelled = abortSignal?.aborted === true
  let nativeActionPending = true
  let nativeDispatchStarted = false
  let pendingTerminalCompletion: PendingTerminalCompletion | null = null
  const reportTerminalCompletion = (
    completion: PendingTerminalCompletion,
    failureLog: string,
    priority: TerminalCompletionPriority = 'executed'
  ): void => {
    const retainedCompletion = completeTerminalCompletionReservation(
      toolCallId,
      completionReservation,
      completion,
      priority,
      failureLog
    )
    if (!retainedCompletion) return
    pendingTerminalCompletion = retainedCompletion.completion ?? null
    scheduleTerminalCompletion(toolCallId, completion)
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
  completionReservation.onPendingChange = (pending) => {
    pendingTerminalCompletion = pending
  }
  completionReservation.onRelease = () => {
    pendingTerminalCompletion = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide)
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
      reportTerminalCompletion(
        {
          status: ASYNC_TOOL_CONFIRMATION_STATUS.error,
          message: SESSION_CLOSED_MESSAGE,
          data: { error: SESSION_CLOSED_MESSAGE, sessionClosed: true },
        },
        'Failed to report browser session-closed error',
        'guard'
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
      reportTerminalCompletion(
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
    reportTerminalCompletion(
      {
        status: ASYNC_TOOL_CONFIRMATION_STATUS.success,
        message: 'Browser action completed',
        data: sanitizeResultForModel(toolName, result),
      },
      'Failed to report successful browser tool completion'
    )
  } finally {
    abortSignal?.removeEventListener('abort', onAbort)
    if (
      retainedTerminalCompletions.get(toolCallId) === completionReservation &&
      completionReservation.deliveryState === 'reserved'
    ) {
      deleteRetainedTerminalCompletion(toolCallId, completionReservation)
    }
    if (typeof window !== 'undefined' && !pendingTerminalCompletion) {
      window.removeEventListener('pagehide', onPageHide)
    }
  }
}
