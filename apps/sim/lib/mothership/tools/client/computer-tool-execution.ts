import { COMPUTER_USE_TOOL_TIMEOUT_MS } from '@sim/desktop-bridge'
import { ComputerUseSchema } from '@sim/desktop-bridge/computer-use'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import { cancelComputerUseTool, executeComputerUseTool } from '@/lib/computer-use/transport'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncConfirmationStatus,
} from '@/lib/mothership/async-runs/lifecycle'
import { BrowserToolReplayLedger } from '@/lib/mothership/tools/client/browser-tool-replay-ledger'
import {
  reportClientToolCompletion,
  reportClientToolCompletionOnPageExit,
} from '@/lib/mothership/tools/client/completion'
import { computerToolResultForModel } from '@/lib/mothership/tools/client/computer-tool-result'

const logger = createLogger('ComputerToolExecution')
const MAX_EVENT_AGE_MS = 120_000
const MAX_UNDELIVERED_RESULTS = 8
const replayLedger = new BrowserToolReplayLedger({
  storageKey: 'sim:computer-tool-ledger:v1',
  legacyStoragePrefix: 'sim:computer-tool-executed:',
  maxEntries: 2048,
  ttlMs: 5 * 60_000,
  protectedWindowMs: MAX_EVENT_AGE_MS,
})
interface Completion {
  status: AsyncConfirmationStatus
  message: string
  data?: unknown
}
interface Execution {
  completion?: Completion
  reporting?: Promise<void>
}
const executions = new Map<string, Execution>()

async function deliver(toolCallId: string, execution: Execution): Promise<void> {
  if (execution.reporting) return execution.reporting
  const completion = execution.completion
  if (!completion) return
  execution.reporting = reportClientToolCompletion(
    toolCallId,
    completion.status,
    completion.message,
    completion.data
  )
    .then(() => {
      executions.delete(toolCallId)
    })
    .catch((error) => {
      logger.warn('Computer action result delivery failed; retained for redelivery', {
        toolCallId,
        error: getErrorMessage(error),
      })
    })
    .finally(() => {
      execution.reporting = undefined
    })
  return execution.reporting
}

/** A live stream may dispatch each server-persisted action once; reconnects only redeliver its result. */
export async function executeComputerToolOnClient(
  toolCallId: string,
  params: Record<string, unknown>,
  eventTs?: string,
  signal?: AbortSignal
): Promise<void> {
  const existing = executions.get(toolCallId)
  if (existing) return deliver(toolCallId, existing)
  const execution: Execution = {}
  const reject = async (message: string, data?: Record<string, unknown>) => {
    await reportClientToolCompletion(toolCallId, ASYNC_TOOL_CONFIRMATION_STATUS.error, message, {
      error: message,
      ...data,
    }).catch((error) =>
      logger.warn('Could not report computer action rejection', {
        toolCallId,
        error: getErrorMessage(error),
      })
    )
  }
  if (executions.size >= MAX_UNDELIVERED_RESULTS)
    return reject(
      'Computer use is waiting for earlier action results to reach the server. Try again after the connection recovers.'
    )
  const emittedAt = eventTs ? Date.parse(eventTs) : Number.NaN
  if (
    !Number.isFinite(emittedAt) ||
    Date.now() - emittedAt > MAX_EVENT_AGE_MS ||
    emittedAt - Date.now() > 5000
  )
    return reject(
      'This computer action is stale. Inspect the app again before deciding what to do.',
      { doNotRetry: true, outcomeUnknown: true }
    )
  const parsed = ComputerUseSchema.safeParse(omit(params, ['activity']))
  if (!parsed.success)
    return reject('Computer action arguments are invalid. Inspect the tool schema and try again.')
  const claim = replayLedger.claim(toolCallId)
  if (claim !== 'claimed')
    return reject(
      claim === 'duplicate'
        ? 'This computer action may already have run. Inspect the app before repeating it.'
        : 'Computer use could not establish reload-safe replay protection. Enable browser storage and try again.',
      claim === 'duplicate' ? { doNotRetry: true, outcomeUnknown: true } : undefined
    )
  executions.set(toolCallId, execution)
  const actionController = new AbortController()
  let dispatched = false
  let cancelled = signal?.aborted === true
  const cancel = () => {
    cancelled = true
    actionController.abort()
    void cancelComputerUseTool(toolCallId).catch((error) =>
      logger.warn('Computer action cancellation failed', {
        toolCallId,
        error: getErrorMessage(error),
      })
    )
  }
  const onPageHide = () => {
    cancel()
    void reportClientToolCompletionOnPageExit(
      toolCallId,
      ASYNC_TOOL_CONFIRMATION_STATUS.error,
      'The desktop view closed during a computer action. Inspect the app before repeating it.',
      { outcomeUnknown: dispatched, doNotRetry: dispatched }
    ).catch((error) =>
      logger.warn('Computer action page-exit result failed', {
        toolCallId,
        error: getErrorMessage(error),
      })
    )
  }
  signal?.addEventListener('abort', cancel, { once: true })
  window.addEventListener('pagehide', onPageHide)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (!cancelled) {
      dispatched = true
      const result = await Promise.race([
        executeComputerUseTool(toolCallId, parsed.data, actionController.signal),
        new Promise<never>((_resolve, rejectTimeout) => {
          timer = setTimeout(() => {
            cancel()
            rejectTimeout(new Error('Computer action timed out; its effect may be incomplete'))
          }, COMPUTER_USE_TOOL_TIMEOUT_MS)
        }),
      ])
      execution.completion = cancelled
        ? {
            status: ASYNC_TOOL_CONFIRMATION_STATUS.cancelled,
            message: 'Computer action stopped. Inspect the app before repeating it.',
            data: { outcomeUnknown: true, doNotRetry: true },
          }
        : {
            status: ASYNC_TOOL_CONFIRMATION_STATUS.success,
            message:
              result.kind === 'action' && !result.verified
                ? 'Input was dispatched. Inspect the app to verify its effect.'
                : 'Computer observation completed',
            data: computerToolResultForModel(result),
          }
    } else
      execution.completion = {
        status: ASYNC_TOOL_CONFIRMATION_STATUS.cancelled,
        message: 'Computer action stopped before execution',
      }
  } catch (error) {
    execution.completion = {
      status: cancelled
        ? ASYNC_TOOL_CONFIRMATION_STATUS.cancelled
        : ASYNC_TOOL_CONFIRMATION_STATUS.error,
      message: getErrorMessage(error, 'Computer action failed'),
      data: { doNotRetry: dispatched, outcomeUnknown: dispatched },
    }
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    window.removeEventListener('pagehide', onPageHide)
  }
  await deliver(toolCallId, execution)
}
