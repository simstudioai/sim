import { createLogger } from '@sim/logger'
import { interruptibleSleep } from '@sim/utils/helpers'
import type { AsyncTerminalCompletionSnapshot } from '@/lib/mothership/async-runs/lifecycle'
import { MothershipStreamV1ToolOutcome } from '@/lib/mothership/generated/mothership-stream-v1'
import { CopilotDegradedReason } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { recordDegraded } from '@/lib/mothership/request/metrics'
import { waitForClientToolCompletion } from '@/lib/mothership/request/tools/client'
import { settleToolCallFailure } from '@/lib/mothership/request/tools/tool-call-failure'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('CopilotDesktopToolWait')

const DESKTOP_TOOL_NOT_STARTED_MESSAGE =
  'Not run: this chat is not open in the Sim desktop app, so nothing picked up this call and nothing happened on the user’s computer. It is safe to retry once the user opens this chat in the Sim desktop app.'

/** The model-facing result of a desktop call that was never picked up. */
export function desktopToolNotStarted(): { message: string; data: Record<string, unknown> } {
  return {
    message: DESKTOP_TOOL_NOT_STARTED_MESSAGE,
    data: { error: DESKTOP_TOOL_NOT_STARTED_MESSAGE, notStarted: true },
  }
}

interface WaitForDesktopToolCallParams {
  toolCallId: string
  runId?: string
  userId: string
  timeoutMs: number
  /** How long the desktop has to claim the call before it fails as never started. */
  pickupGraceMs: number
  abortSignal?: AbortSignal
  registry?: ResolvedSecretTraceRegistry
}

/**
 * Waits for a desktop tool call the desktop claims on pickup, and fails it fast when nothing
 * picks it up.
 *
 * Only the chat view showing this chat starts a desktop call, so one issued while the user is
 * elsewhere is never claimed. After the pickup grace the still-pending call is settled as never
 * started with the inverse of the desktop's claim (`pending -> failed`), so exactly one of the two
 * wins: a desktop that claims it later is refused, and a call claimed in time keeps waiting for
 * its result within the original `timeoutMs`.
 */
export async function waitForDesktopToolCall(
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
  if (first.kind === 'reported') return first.completion
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
