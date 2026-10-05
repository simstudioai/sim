import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { DESKTOP_CALL_PICKUP_GRACE_MS } from '@/lib/desktop/executor/constants'
import { ringDesktopInbox } from '@/lib/desktop/executor/doorbell'
import { isDesktopPresent } from '@/lib/desktop/executor/presence'
import {
  failLapsedDesktopCall,
  failUnclaimedDesktopCall,
  getDesktopCallState,
  offerDesktopCall,
} from '@/lib/desktop/executor/repository'
import { ASYNC_TOOL_STATUS, isTerminalAsyncStatus } from '@/lib/mothership/async-runs/lifecycle'
import { publishToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import {
  retainSealedClientToolContext,
  sealClientToolCompletion,
} from '@/lib/mothership/request/tools/client-completion-seal.server'

const logger = createLogger('DesktopCallSupervisor')

/** Wakes at least this often, so a call settled elsewhere releases its supervisor promptly. */
const MAX_WAIT_MS = 5_000
/** Lets the database clock pass a deadline before the supervisor re-reads it. */
const DEADLINE_SLACK_MS = 25

export const DESKTOP_OFFLINE_MESSAGE =
  "Not run: the Sim desktop app that started this chat is offline. Nothing happened on the user's computer. Continue without desktop tools, or ask the user to open Sim desktop."

export const DESKTOP_NOT_RESPONDING_MESSAGE =
  "Not run: the Sim desktop app that started this chat did not pick up this action in time. Nothing happened on the user's computer. Continue without desktop tools, or ask the user to check Sim desktop."

export const DESKTOP_LEASE_LOST_MESSAGE =
  "Started on the user's computer, but its result was lost because the Sim desktop app stopped responding. Its effect may have landed; inspect the current state before repeating it."

export type DesktopCallSupervision =
  /** Another path owns the call: it was not pending and unoffered. */
  | 'not_offered'
  | 'offline'
  | 'not_responding'
  | 'lease_lost'
  /** The device's result, Stop, or another settlement ended it. */
  | 'settled'
  | 'aborted'

interface SuperviseDesktopCallInput {
  toolCallId: string
  runId: string
  userId: string
  deviceId: string
  signal?: AbortSignal
  pickupGraceMs?: number
}

type Failure =
  | { reason: 'offline' | 'not_responding'; message: string; notStarted: true }
  | { reason: 'lease_lost'; message: string; outcomeUnknown: true; doNotRetry: true }

/** Seals the failure to its run exactly as a device result is sealed, so the waiter unseals it. */
async function sealFailure(input: SuperviseDesktopCallInput, existing: unknown, failure: Failure) {
  const { message, ...flags } = failure
  return {
    ...retainSealedClientToolContext(existing),
    ...(await sealClientToolCompletion({
      toolCallId: input.toolCallId,
      runId: input.runId,
      userId: input.userId,
      message,
      data: { error: message, ...flags },
    })),
  }
}

function wake(input: SuperviseDesktopCallInput, message: string, data: unknown) {
  publishToolConfirmation({
    toolCallId: input.toolCallId,
    status: 'error',
    message,
    timestamp: new Date().toISOString(),
    data,
  })
}

/**
 * Owns a desktop call on a device-bound run from the moment it may run until it settles: offers
 * it to the device and rings the doorbell, fails it at once as not started when the device is
 * offline or after the pickup window when nobody claimed it, and fails it as outcome unknown when
 * a claimed call's lease lapses. A running call stays alive for as long as the device renews it.
 * Every settlement is a CAS against the device's own transitions, so exactly one wins, and every
 * failure is published so the run's waiter reads it at once.
 */
export async function superviseDesktopCall(
  input: SuperviseDesktopCallInput
): Promise<DesktopCallSupervision> {
  const offered = await offerDesktopCall({
    toolCallId: input.toolCallId,
    runId: input.runId,
    pickupGraceMs: input.pickupGraceMs ?? DESKTOP_CALL_PICKUP_GRACE_MS,
  })
  if (!offered) return 'not_offered'
  ringDesktopInbox(input.deviceId, 'call')

  const failUnclaimed = async (
    reason: 'offline' | 'not_responding',
    message: string,
    deadlinePassed: boolean
  ) => {
    const state = await getDesktopCallState(input.toolCallId)
    const result = await sealFailure(input, state?.result, { reason, message, notStarted: true })
    const failed = await failUnclaimedDesktopCall({
      toolCallId: input.toolCallId,
      runId: input.runId,
      result,
      error: message,
      deadlinePassed,
    })
    if (failed) wake(input, message, result)
    return failed
  }

  if (!(await isDesktopPresent(input.deviceId).catch(() => false))) {
    if (await failUnclaimed('offline', DESKTOP_OFFLINE_MESSAGE, false)) return 'offline'
  }

  for (;;) {
    if (input.signal?.aborted) return 'aborted'
    const state = await getDesktopCallState(input.toolCallId)
    if (!state || isTerminalAsyncStatus(state.status)) return 'settled'
    const remainingMs = state.msUntilLeaseEnd ?? 0
    if (state.status === ASYNC_TOOL_STATUS.pending && !state.ownerToken) {
      if (remainingMs <= 0) {
        if (await failUnclaimed('not_responding', DESKTOP_NOT_RESPONDING_MESSAGE, true))
          return 'not_responding'
        continue
      }
    } else if (state.status === ASYNC_TOOL_STATUS.running && state.ownerToken) {
      if (remainingMs <= 0) {
        const result = await sealFailure(input, state.result, {
          reason: 'lease_lost',
          message: DESKTOP_LEASE_LOST_MESSAGE,
          outcomeUnknown: true,
          doNotRetry: true,
        })
        const failed = await failLapsedDesktopCall({
          toolCallId: input.toolCallId,
          runId: input.runId,
          ownerToken: state.ownerToken,
          result,
          error: DESKTOP_LEASE_LOST_MESSAGE,
        })
        if (failed) {
          wake(input, DESKTOP_LEASE_LOST_MESSAGE, result)
          return 'lease_lost'
        }
        continue
      }
    } else {
      return 'settled'
    }
    await interruptibleSleep(Math.min(remainingMs + DEADLINE_SLACK_MS, MAX_WAIT_MS), input.signal)
  }
}

/** Runs the supervisor alongside the call's waiter; a supervisor fault only loses fast failure. */
export function startDesktopCallSupervisor(input: SuperviseDesktopCallInput): void {
  void superviseDesktopCall(input).then(
    (outcome) => {
      if (outcome !== 'settled' && outcome !== 'aborted')
        logger.info('Desktop call settled by its supervisor', {
          toolCallId: input.toolCallId,
          runId: input.runId,
          deviceId: input.deviceId,
          outcome,
        })
    },
    (error) =>
      logger.error('Desktop call supervisor failed', {
        toolCallId: input.toolCallId,
        runId: input.runId,
        error: getErrorMessage(error),
      })
  )
}
