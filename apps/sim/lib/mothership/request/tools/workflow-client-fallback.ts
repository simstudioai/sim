import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import type {
  AsyncCompletionSignal,
  AsyncTerminalCompletionSnapshot,
} from '@/lib/mothership/async-runs/lifecycle'
import { claimWorkflowToolExecution } from '@/lib/mothership/async-runs/repository'
import { CopilotDegradedReason } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { recordDegraded } from '@/lib/mothership/request/metrics'
import { waitForWorkflowToolCompletion } from '@/lib/mothership/request/tools/client'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('CopilotWorkflowClientFallback')

/** Which side actually ran the workflow for this tool call. */
export type WorkflowToolWinner = 'client' | 'sim'

export interface WorkflowToolRaceOutcome {
  winner: WorkflowToolWinner
  /** Set when `winner === 'client'`; null means the client wait timed out. */
  completion?: AsyncTerminalCompletionSnapshot | null
  /** Set when `winner === 'sim'`. */
  signal?: AsyncCompletionSignal
  /** The execution id the server claimed, when it won. */
  boundExecutionId?: string
}

interface RaceWorkflowToolClientPickupParams {
  toolCallId: string
  workflowId?: string
  timeoutMs: number
  graceMs: number
  abortSignal?: AbortSignal
  registry?: ResolvedSecretTraceRegistry
  /** Runs the tool in-process; only invoked after the execution claim is won. */
  runOnServer: (boundExecutionId: string) => Promise<AsyncCompletionSignal>
}

/**
 * Wait for a browser to run a workflow tool call, and run it here if none does.
 *
 * Workflow tools are client-routed, but the only thing that dispatches one is
 * the mounted chat view. A call frame that arrives while the user sits on a
 * different chat is picked up by nobody, and the turn used to park for the full
 * `timeoutMs` (an hour) before failing.
 *
 * After `graceMs` with no result, this competes for the same single-winner
 * execution claim that `/api/workflows/[id]/execute` takes on the browser's
 * behalf. Losing the claim means a browser really is running it, so we go back
 * to waiting; winning it means nobody was there, so we run it in-process.
 * Because both sides contend on `claimedBy IS NULL`, the workflow can never run
 * twice — a browser arriving late gets a 409 it already treats as benign.
 */
export async function raceWorkflowToolClientPickup(
  params: RaceWorkflowToolClientPickupParams
): Promise<WorkflowToolRaceOutcome> {
  const { toolCallId, workflowId, timeoutMs, graceMs, abortSignal, registry, runOnServer } = params

  // Cancels only OUR client waiter once the server takes over, without
  // disturbing the caller's turn-level abort signal.
  const cancelClientWait = new AbortController()
  const clientWaitSignal = abortSignal
    ? AbortSignal.any([abortSignal, cancelClientWait.signal])
    : cancelClientWait.signal

  // Exactly one waiter for the whole race — a second one would double-consume
  // the confirmation and emit a duplicate tool result.
  const clientWait = waitForWorkflowToolCompletion({
    toolCallId,
    workflowId,
    timeoutMs,
    abortSignal: clientWaitSignal,
    registry,
  })

  // A caller-supplied timeout shorter than the grace must win, or the grace
  // would outlive the wait it is supposed to bound.
  const effectiveGraceMs = Math.min(graceMs, timeoutMs)

  const first = await Promise.race([
    clientWait.then((completion) => ({ kind: 'client' as const, completion })),
    sleep(effectiveGraceMs).then(() => ({ kind: 'grace' as const })),
  ])

  // A non-null client result inside the grace window is the normal path.
  // A null one means the wait itself already expired (timeoutMs <= graceMs), so
  // fall through and try the claim rather than reporting a missing completion.
  if (first.kind === 'client' && first.completion !== null) {
    return { winner: 'client', completion: first.completion }
  }

  // Never claim work on a turn the user already stopped.
  if (abortSignal?.aborted) {
    return { winner: 'client', completion: await clientWait }
  }

  const boundExecutionId = generateId()
  // The repository returns `row ?? null`, but with no `noUncheckedIndexedAccess`
  // the destructured row types as non-optional and the null collapses away.
  // It is genuinely null when the claim is lost, so widen it back — the same
  // reality `/api/workflows/[id]/execute` leans on for its `if (!boundToolCall)`.
  let claimed: Awaited<ReturnType<typeof claimWorkflowToolExecution>> | null = null
  try {
    claimed = await claimWorkflowToolExecution(toolCallId, boundExecutionId, 'sim')
  } catch (error) {
    // Losing the claim to an error is not a reason to run the workflow twice;
    // fall back to waiting on the browser exactly as before.
    logger.warn('Failed to claim workflow tool execution for server fallback', {
      toolCallId,
      workflowId,
      error: toError(error).message,
    })
    return { winner: 'client', completion: await clientWait }
  }

  if (!claimed) {
    logger.info('Workflow tool already claimed by a client; continuing to wait', {
      toolCallId,
      workflowId,
    })
    return { winner: 'client', completion: await clientWait }
  }

  recordDegraded(CopilotDegradedReason.ClientPickupTimeout)
  logger.info('No client picked up workflow tool within grace; running it server-side', {
    toolCallId,
    workflowId,
    boundExecutionId,
    graceMs: effectiveGraceMs,
  })

  // Tear the waiter down BEFORE running in-process. The server path publishes
  // its own terminal confirmation on the same channel this waiter subscribes
  // to, so a live waiter would resolve with our own result and emit a second,
  // client-flavored tool result on top of it. Awaiting is what guarantees the
  // subscription is gone, not just signalled.
  cancelClientWait.abort()
  await clientWait

  return { winner: 'sim', signal: await runOnServer(boundExecutionId), boundExecutionId }
}
