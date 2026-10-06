/**
 * Client-side execution of `terminal_*` copilot tools.
 *
 * Mirrors the other client-executed tool flows (browser, run-tool, local
 * filesystem): the Go orchestrator emits a client-executed tool call and blocks
 * on Redis; this module performs the action through the desktop app's terminal
 * and reports the outcome via the confirm endpoint, which wakes the
 * server-side waiter.
 */

import {
  terminalOperationTimeoutMs,
  terminalToolCompletion,
  terminalToolFailure,
} from '@sim/desktop-bridge/tool-results'
import { createLogger } from '@sim/logger'
import {
  isTerminalOperation,
  type TerminalOperation,
  type TerminalToolArgs,
} from '@sim/terminal-protocol'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { ASYNC_TOOL_CONFIRMATION_STATUS } from '@/lib/mothership/async-runs/lifecycle'
import { COPILOT_CONFIRM_API_PATH } from '@/lib/mothership/constants'
import { reportClientToolCompletion } from '@/lib/mothership/tools/client/completion'
import { executeTerminalTool } from '@/lib/terminal/transport'

const logger = createLogger('CopilotTerminalToolExecution')

/** Tool events older than this are replays, not live instructions. */
const MAX_EVENT_AGE_MS = 120_000
const STALE_EVENT_MESSAGE =
  'Not run: this terminal command never started, because it reached the Sim desktop app too late to start safely. Nothing ran on the user’s computer. Do not retry it in this turn; tell the user to keep this chat open in the Sim desktop app, or to ask again later.'
const EXECUTED_STORAGE_PREFIX = 'sim:copilot:terminal-tool-executed:'

/**
 * Exactly-once guard. Stream recovery and tab reloads replay persisted tool
 * events, and re-running a shell command is the least forgiving thing in this
 * codebase to get wrong — `rm -rf` twice is not the same as once. In-memory set
 * for the fast path, sessionStorage so a reload of the same tab cannot
 * re-execute what it already did.
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

function eventAgeMs(eventTs: string | undefined): number | null {
  if (!eventTs) return null
  const emitted = Date.parse(eventTs)
  return Number.isNaN(emitted) ? null : Date.now() - emitted
}

/**
 * Splits a `terminal` tool call into its operation and arguments. The model
 * supplies both inside one params object, and an unrecognized operation is
 * rejected here rather than sent to the desktop, so a malformed call fails
 * with a useful message instead of a bridge error.
 */
function parseCall(params: Record<string, unknown>): {
  operation: TerminalOperation
  args: TerminalToolArgs
} | null {
  const operation = params.operation
  if (!isTerminalOperation(operation)) return null
  const args = params.args
  return {
    operation,
    args: isRecordLike(args) ? (args as TerminalToolArgs) : {},
  }
}

/**
 * Fire-and-forget entry point invoked by the stream tool-event handler when a
 * `terminal` client tool call arrives.
 *
 * @param eventTs - the stream envelope's emission timestamp; stale events
 * (replays after reconnect/reload) are dropped rather than re-executed.
 */
export function executeTerminalToolOnClient(
  toolCallId: string,
  params: Record<string, unknown>,
  scopeId: string,
  eventTs?: string
): void {
  const call = parseCall(params)
  if (!call) {
    logger.warn('Ignoring terminal tool call with no recognized operation', { toolCallId })
    return
  }
  const operation = call.operation
  if (hasAlreadyExecuted(toolCallId)) {
    logger.info('Skipping already-executed terminal tool (replay)', { toolCallId, operation })
    return
  }
  const age = eventAgeMs(eventTs)
  if (age !== null && age > MAX_EVENT_AGE_MS) {
    logger.info('Reporting stale terminal tool event as not started', {
      toolCallId,
      operation,
      age,
    })
    // Reported against the pending call only: one another window already claimed keeps its result.
    void reportClientToolCompletion(
      toolCallId,
      ASYNC_TOOL_CONFIRMATION_STATUS.error,
      STALE_EVENT_MESSAGE,
      { error: STALE_EVENT_MESSAGE, notStarted: true, staleEvent: true }
    ).catch((error) => {
      logger.warn('Failed to report stale terminal tool event', {
        toolCallId,
        error: toError(error).message,
      })
    })
    return
  }
  markExecuted(toolCallId)
  void doExecuteTerminalTool(toolCallId, operation, call.args, scopeId).catch((err) => {
    logger.error('Unhandled error in client-side terminal tool execution', {
      toolCallId,
      operation,
      error: toError(err).message,
    })
  })
}

async function doExecuteTerminalTool(
  toolCallId: string,
  operation: TerminalOperation,
  args: TerminalToolArgs,
  scopeId: string
): Promise<void> {
  // If the user leaves the page mid-command the awaited result is lost; tell
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
              'The user left the Sim window while this terminal command was running, so its result was lost.',
            data: { outcomeUnknown: true, doNotRetry: true },
          }),
        ],
        { type: 'application/json' }
      )
    )
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide)
  }

  logger.info('Executing terminal operation via the desktop terminal', { toolCallId, operation })

  try {
    const timeoutMs = terminalOperationTimeoutMs(operation)
    const invocation = executeTerminalTool(toolCallId, operation, args, scopeId)
    const result =
      timeoutMs === null
        ? await invocation
        : await Promise.race([
            invocation,
            new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(new Error(`The terminal did not respond within ${timeoutMs}ms`)),
                timeoutMs
              )
            }),
          ])
    const completion = terminalToolCompletion({ ok: true, result })
    await reportClientToolCompletion(
      toolCallId,
      completion.status,
      completion.message,
      completion.data
    )
  } catch (err) {
    const error = toError(err)
    logger.warn('Terminal operation failed', { toolCallId, operation, error: error.message })
    // The error's name goes to the model as its code, `Error` included, as it always has.
    const completion = terminalToolFailure(error.message, error.name || undefined)
    await reportClientToolCompletion(
      toolCallId,
      completion.status,
      completion.message,
      completion.data
    ).catch((reportErr) => {
      logger.error('Failed to report terminal tool error', {
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
