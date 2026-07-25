/**
 * Client-side execution of `terminal_*` copilot tools.
 *
 * Mirrors the other client-executed tool flows (browser, run-tool, local
 * filesystem): the Go orchestrator emits a client-executed tool call and blocks
 * on Redis; this module performs the action through the desktop app's terminal
 * and reports the outcome via the confirm endpoint, which wakes the
 * server-side waiter.
 */
import { createLogger } from '@sim/logger'
import {
  isTerminalOperation,
  type TerminalOperation,
  type TerminalToolArgs,
} from '@sim/terminal-protocol'
import { toError } from '@sim/utils/errors'
import { ASYNC_TOOL_CONFIRMATION_STATUS } from '@/lib/copilot/async-runs/lifecycle'
import { COPILOT_CONFIRM_API_PATH } from '@/lib/copilot/constants'
import { reportClientToolCompletion } from '@/lib/copilot/tools/client/completion'
import { executeTerminalTool } from '@/lib/terminal/transport'

const logger = createLogger('CopilotTerminalToolExecution')

/** Tool events older than this are replays, not live instructions. */
const MAX_EVENT_AGE_MS = 120_000
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
 * `terminal_run` has no client-side deadline: it can sit on an approval chip
 * for as long as the user takes, and the desktop side already bounds the
 * command itself. The rest are near-instant, so a short timeout keeps a wedged
 * bridge from stalling the turn.
 */
const QUICK_TOOL_TIMEOUT_MS = 15_000

function timeoutForOperation(operation: TerminalOperation): number | null {
  return operation === 'run' ? null : QUICK_TOOL_TIMEOUT_MS
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
    args:
      args && typeof args === 'object' && !Array.isArray(args) ? (args as TerminalToolArgs) : {},
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
    logger.info('Skipping stale terminal tool event', { toolCallId, operation, age })
    return
  }
  markExecuted(toolCallId)
  void doExecuteTerminalTool(toolCallId, operation, call.args).catch((err) => {
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
  args: TerminalToolArgs
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
    const timeoutMs = timeoutForOperation(operation)
    const invocation = executeTerminalTool(toolCallId, operation, args)
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
    await reportClientToolCompletion(
      toolCallId,
      ASYNC_TOOL_CONFIRMATION_STATUS.success,
      'Terminal action completed',
      result as Record<string, unknown> | undefined
    )
  } catch (err) {
    const error = toError(err)
    // A declined command is a normal outcome, not a fault: reporting it as
    // cancelled lets the model adapt instead of retrying the same command.
    const status =
      error.name === 'REJECTED'
        ? ASYNC_TOOL_CONFIRMATION_STATUS.cancelled
        : ASYNC_TOOL_CONFIRMATION_STATUS.error
    logger.warn('Terminal operation failed', { toolCallId, operation, error: error.message })
    await reportClientToolCompletion(toolCallId, status, error.message, {
      error: error.message,
      ...(error.name ? { code: error.name } : {}),
    }).catch((reportErr) => {
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
