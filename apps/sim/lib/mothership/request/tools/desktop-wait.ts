import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { toRecordOrNull } from '@sim/utils/object'
import { ringDesktopInbox } from '@/lib/desktop/executor/doorbell'
import { isDesktopPresent } from '@/lib/desktop/executor/presence'
import {
  type DesktopToolCallDeadlines,
  getDesktopToolCallDeadlines,
  listOverdueDesktopToolCalls,
  offerDesktopToolCall,
} from '@/lib/desktop/executor/repository'
import {
  ASYNC_TOOL_STATUS,
  type AsyncTerminalCompletionSnapshot,
} from '@/lib/mothership/async-runs/lifecycle'
import { MothershipStreamV1ToolOutcome } from '@/lib/mothership/generated/mothership-stream-v1'
import { CopilotDegradedReason } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { recordDegraded } from '@/lib/mothership/request/metrics'
import { settleToolCallFailure } from '@/lib/mothership/request/tools/call-failure'
import { waitForClientToolCompletion } from '@/lib/mothership/request/tools/client'
import { sealClientToolSettlement } from '@/lib/mothership/request/tools/client-completion-seal.server'
import {
  type ClientToolSettlementGuard,
  settleClientToolCall,
} from '@/lib/mothership/request/tools/client-settlement.server'
import { isBackgroundDesktopToolCall } from '@/lib/mothership/tools/desktop-tools'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('CopilotDesktopToolWait')

/**
 * Why a desktop call never started:
 * - `chat_not_open`: nothing in the desktop app picked it up for a chat view;
 * - `offline`: the desktop bound to this chat's turn is not connected;
 * - `not_responding`: that desktop is connected but did not claim it in time.
 */
export type DesktopToolNotStartedReason = 'chat_not_open' | 'offline' | 'not_responding'

const NOT_STARTED_MESSAGES: Record<DesktopToolNotStartedReason, string> = {
  chat_not_open:
    'Not run: this action never started, because nothing in the Sim desktop app picked it up. Nothing happened on the user’s computer. Do not retry it in this turn; tell the user to keep this chat open in the Sim desktop app, or to ask again later.',
  offline:
    'Not run: this action never started, because the Sim desktop app running this chat is offline. Nothing happened on the user’s computer. Do not retry it in this turn; tell the user to open the Sim desktop app and stay signed in, or to ask again later.',
  not_responding:
    'Not run: this action never started, because the Sim desktop app running this chat did not pick it up in time. Nothing happened on the user’s computer. Do not retry it in this turn; tell the user to check that the Sim desktop app is open and responding, or to ask again later.',
}

const DESKTOP_TOOL_LEASE_LAPSED_MESSAGE =
  'The Sim desktop app started this action on the user’s computer but stopped reporting on it, so its result was lost. It may already have taken effect: inspect the current state before repeating it, and do not retry it automatically.'

interface DesktopToolFailure {
  message: string
  data: Record<string, unknown>
}

/** The model-facing result of a desktop call that was never picked up. */
export function desktopToolNotStarted(
  reason: DesktopToolNotStartedReason = 'chat_not_open'
): DesktopToolFailure {
  const message = NOT_STARTED_MESSAGES[reason]
  return { message, data: { error: message, notStarted: true, reason } }
}

function desktopToolLeaseLapsed(): DesktopToolFailure {
  return {
    message: DESKTOP_TOOL_LEASE_LAPSED_MESSAGE,
    data: { error: DESKTOP_TOOL_LEASE_LAPSED_MESSAGE, outcomeUnknown: true, doNotRetry: true },
  }
}

interface WaitForDesktopToolCallParams {
  toolCallId: string
  runId?: string
  userId: string
  timeoutMs: number
  /** How long the desktop has to claim the call before it fails as never started. */
  pickupGraceMs: number
  /** The device whose background executor runs this turn's desktop calls; absent for a chat view. */
  desktopDeviceId?: string | null
  abortSignal?: AbortSignal
  registry?: ResolvedSecretTraceRegistry
}

/**
 * Waits for a desktop tool call the desktop claims on pickup, and fails it fast when nothing
 * picks it up. A turn bound to a device's background executor offers the call to that device;
 * any other turn waits for the chat view showing the chat.
 */
export async function waitForDesktopToolCall(
  params: WaitForDesktopToolCallParams
): Promise<AsyncTerminalCompletionSnapshot | null> {
  const { runId, desktopDeviceId } = params
  if (runId && desktopDeviceId)
    return waitForBoundDesktopToolCall({ ...params, runId, desktopDeviceId })
  return waitForChatViewDesktopToolCall(params)
}

/**
 * Only the chat view showing this chat starts a desktop call, so one issued while the user is
 * elsewhere is never claimed. After the pickup grace the still-pending call is settled as never
 * started with the inverse of the desktop's claim (`pending -> failed`), so exactly one of the two
 * wins: a desktop that claims it later is refused, and a call claimed in time keeps waiting for
 * its result within the original `timeoutMs`.
 */
async function waitForChatViewDesktopToolCall(
  params: WaitForDesktopToolCallParams
): Promise<AsyncTerminalCompletionSnapshot | null> {
  const { toolCallId, timeoutMs, pickupGraceMs, abortSignal } = params
  const startedAt = Date.now()
  const stopPickupWait = new AbortController()
  const pickupWait = waitForClientToolCompletion({
    ...params,
    abortSignal: abortSignal
      ? AbortSignal.any([abortSignal, stopPickupWait.signal])
      : stopPickupWait.signal,
  })
  const graceOver = new AbortController()
  const first = await Promise.race([
    pickupWait.then((completion) => ({ kind: 'reported' as const, completion })),
    interruptibleSleep(Math.min(pickupGraceMs, timeoutMs), graceOver.signal).then(() => ({
      kind: 'grace' as const,
    })),
  ])
  graceOver.abort()
  if (first.kind === 'reported' && first.completion) return first.completion
  if (abortSignal?.aborted) return pickupWait

  // A result that landed as the grace ran out is already being restored: it is the answer.
  stopPickupWait.abort()
  const lateResult = await pickupWait
  if (lateResult) return lateResult

  const notStarted = desktopToolNotStarted()
  const settlement = await settleToolCallFailure({
    toolCallId,
    runId: params.runId,
    userId: params.userId,
    registry: params.registry,
    ...notStarted,
    unclaimedOnly: true,
  })
  if (settlement !== 'settled') {
    return waitForClientToolCompletion({
      ...params,
      timeoutMs: Math.max(0, timeoutMs - (Date.now() - startedAt)),
    })
  }

  recordDegraded(CopilotDegradedReason.ClientPickupTimeout)
  logger.info('No desktop picked up the tool call within its grace; failed it as not started', {
    toolCallId,
    pickupGraceMs,
  })
  return { status: MothershipStreamV1ToolOutcome.error, ...notStarted }
}

/**
 * Offers the call to the bound device and rings its inbox, then waits for its result. Every
 * deadline lives on the row, and the wait's durable check enforces them on each poll, so nothing
 * here keeps time: an offline device fails the call as never started at once, one that misses the
 * pickup window fails it the same way, and a lapsed lease fails it as outcome unknown. Should this
 * process die, the stale-execution cron settles the call from the same row.
 */
async function waitForBoundDesktopToolCall(
  params: WaitForDesktopToolCallParams & { runId: string; desktopDeviceId: string }
): Promise<AsyncTerminalCompletionSnapshot | null> {
  const { toolCallId, runId, desktopDeviceId, pickupGraceMs, abortSignal } = params
  await offerDesktopToolCall({ toolCallId, runId, pickupGraceMs })
  ringDesktopInbox(desktopDeviceId, 'call')
  const completion = await waitForClientToolCompletion({
    ...params,
    settleOverdue: () => settleOverdueDesktopToolCall(toolCallId),
  })
  if (completion || abortSignal?.aborted) return completion

  // The turn's budget ran out first (shorter than the pickup window): a call still unclaimed
  // never started, and settling it, as the inverse of the claim, keeps the device from running it.
  const notStarted = desktopToolNotStarted('not_responding')
  const settlement = await settleToolCallFailure({
    toolCallId,
    runId,
    userId: params.userId,
    registry: params.registry,
    ...notStarted,
    unclaimedOnly: true,
  })
  if (settlement !== 'settled') return null
  recordDegraded(CopilotDegradedReason.ClientPickupTimeout)
  return { status: MothershipStreamV1ToolOutcome.error, ...notStarted }
}

async function settleBoundDesktopToolCall(
  call: DesktopToolCallDeadlines,
  failure: DesktopToolFailure,
  guard: ClientToolSettlementGuard
) {
  const data = await sealClientToolSettlement(call.result, {
    toolCallId: call.toolCallId,
    runId: call.runId,
    userId: call.userId,
    ...failure,
  })
  return settleClientToolCall({
    toolCallId: call.toolCallId,
    status: MothershipStreamV1ToolOutcome.error,
    message: failure.message,
    data,
    guard,
  })
}

/** Whether the device is present, or null when presence cannot be read right now. */
async function readDesktopPresence(deviceId: string): Promise<boolean | null> {
  try {
    return await isDesktopPresent(deviceId)
  } catch (error) {
    logger.warn('Could not read desktop presence; enforcing the pickup window alone', {
      deviceId,
      error: toError(error).message,
    })
    return null
  }
}

/**
 * Settles a bound desktop call that can no longer finish on its own, sealed like the device's own
 * result so whoever waits on it restores it. A pending call fails as never started once its device
 * is offline or its pickup window closed, as the inverse of the claim; a running call whose lease
 * lapsed fails as outcome unknown and revokes the device's token, losing to a renewal. Returns
 * whether this call settled it.
 */
async function settleOverdueDesktopToolCall(toolCallId: string): Promise<boolean> {
  const call = await getDesktopToolCallDeadlines(toolCallId)
  // A VFS read of Sim's own files shares its tool name with a local read, but no desktop runs it.
  if (!call || !isBackgroundDesktopToolCall(call.toolName, toRecordOrNull(call.args) ?? undefined))
    return false
  if (call.status === ASYNC_TOOL_STATUS.pending) {
    const present = await readDesktopPresence(call.deviceId)
    // Before its pickup window closes, a call fails early only when its device is known to be away:
    // no presence, and no pull recent enough that a lost presence write could explain the gap.
    if (!call.pickupOverdue && (present !== false || call.recentlySeen)) return false
    const reason = present === false ? 'offline' : 'not_responding'
    const outcome = await settleBoundDesktopToolCall(call, desktopToolNotStarted(reason), {
      kind: 'pending',
    })
    if (outcome !== 'updated') return false
    recordDegraded(CopilotDegradedReason.ClientPickupTimeout)
    logger.info('Bound desktop never picked up the tool call; failed it as not started', {
      toolCallId,
      deviceId: call.deviceId,
      reason,
    })
    return true
  }
  if (call.status !== ASYNC_TOOL_STATUS.running || !call.leaseLapsed || !call.ownerToken)
    return false
  const outcome = await settleBoundDesktopToolCall(call, desktopToolLeaseLapsed(), {
    kind: 'lapsed',
    ownerToken: call.ownerToken,
  })
  if (outcome !== 'updated') return false
  // The device may still be running it: its inbox now lists the call as cancelled.
  ringDesktopInbox(call.deviceId, 'cancel')
  logger.warn('Bound desktop stopped renewing a running tool call; failed it as outcome unknown', {
    toolCallId,
    deviceId: call.deviceId,
  })
  return true
}

/**
 * A live waiter settles an overdue call within its 5 s poll; past this, the call's waiter is gone.
 */
const ABANDONED_DESKTOP_CALL_SLACK_MS = 60_000
const ABANDONED_DESKTOP_CALL_BATCH = 200

/**
 * The backstop for bound desktop calls whose waiter died with its process: settles each overdue
 * call exactly as its waiter would have. Returns how many it settled.
 */
export async function settleAbandonedDesktopToolCalls(
  slackMs = ABANDONED_DESKTOP_CALL_SLACK_MS
): Promise<number> {
  const toolCallIds = await listOverdueDesktopToolCalls({
    slackMs,
    limit: ABANDONED_DESKTOP_CALL_BATCH,
  })
  let settled = 0
  for (const toolCallId of toolCallIds) {
    try {
      if (await settleOverdueDesktopToolCall(toolCallId)) settled++
    } catch (error) {
      logger.warn('Could not settle an abandoned desktop tool call; the next sweep retries it', {
        toolCallId,
        error: toError(error).message,
      })
    }
  }
  return settled
}
