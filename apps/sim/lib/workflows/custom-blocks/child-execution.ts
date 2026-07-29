import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
} from '@/lib/billing/core/billing-attribution'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import {
  getCancellationChannel,
  isExecutionCancelled,
  isRedisCancellationEnabled,
} from '@/lib/execution/cancellation'
import { BoundarySafeError } from '@/executor/errors/boundary'

/**
 * The payer has no headroom for this custom-block child run.
 *
 * Boundary-safe only as far as the message allows: see
 * {@link admitCustomBlockChildExecution} for why actor-scoped denials are
 * collapsed to {@link GENERIC_USAGE_LIMIT_MESSAGE} before reaching here.
 */
export class CustomBlockAdmissionError extends BoundarySafeError {
  constructor(message: string) {
    super({ message, errorType: 'usage_limit' })
    this.name = 'CustomBlockAdmissionError'
  }
}

/**
 * Consumer-safe stand-in for a denial whose real message describes the SOURCE
 * workflow owner's personal billing state rather than the shared organization.
 */
const GENERIC_USAGE_LIMIT_MESSAGE =
  'This custom block is unavailable because a usage limit was reached. Ask an organization admin to review it.'

/**
 * Admits one custom-block child run against the SOURCE workspace's payer.
 *
 * Performs the attributed usage check but takes no concurrency reservation.
 * The consumer and source workspaces are always in the same organization (the
 * publish gate plus `getCustomBlockAuthority`'s org filter), so `billingEntity`
 * is identical for parent and child: reserving again would burn a second slot
 * from the same payer for one logical run — N+1 slots for a custom block inside
 * an N-iteration loop — and fail runs that work today. There is also no base
 * charge on the child for a reservation to protect.
 */
export async function admitCustomBlockChildExecution(
  attribution: BillingAttributionSnapshot
): Promise<void> {
  const usage = await checkAttributedUsageLimits(attribution)
  if (!usage.isExceeded) return

  // Only the payer-scoped denial describes the shared organization ("Organization
  // usage limit exceeded: $X pooled of $Y organization limit"), which both sides
  // genuinely share and which the consumer can act on.
  //
  // The other gates are evaluated against `actorUserId` — the SOURCE workflow's
  // owner — and their text is addressed to that person: their account-frozen /
  // payment-method state, or "Ask an organization admin to raise YOUR credit
  // limit" against their individual member cap. Forwarding those verbatim would
  // show one org member another's private billing state. Being in the same
  // organization makes the *payer* shared; it does not make personal quotas
  // shared. The `usage_limit` type still tells the consumer what kind of failure
  // this was.
  const message =
    usage.scope === 'payer' && usage.message ? usage.message : GENERIC_USAGE_LIMIT_MESSAGE
  throw new CustomBlockAdmissionError(message)
}

/**
 * Correlation linking a custom-block child's log row back to its invoking run.
 * Ids only — no names — so the publisher can trace an invocation without seeing
 * anything about the consumer's workflow contents.
 */
export function buildCustomBlockCorrelation(params: {
  invokerExecutionId?: string
  invokerRequestId?: string
  invokerWorkflowId?: string
  invokerWorkspaceId?: string
  blockType: string
}): AsyncExecutionCorrelation | undefined {
  if (!params.invokerExecutionId) return undefined
  return {
    source: 'custom_block',
    executionId: params.invokerExecutionId,
    requestId: params.invokerRequestId ?? params.invokerExecutionId,
    workflowId: params.invokerWorkflowId ?? '',
    triggerType: params.blockType,
    ...(params.invokerWorkspaceId ? { invokerWorkspaceId: params.invokerWorkspaceId } : {}),
  }
}

/**
 * Abort signal for a custom-block child. The child runs under its own execution
 * id, so it no longer receives the parent's cancellation pub/sub event (the
 * engine matches on execution id) — this bridges both the parent's abort signal
 * and its cancellation channel onto a signal the child engine honours.
 *
 * Callers MUST call `dispose()`: a custom block inside a loop would otherwise
 * leak one abort listener and one channel subscription per iteration onto a
 * long-lived parent signal.
 */
export async function createChildCancellationSignal(params: {
  parentSignal?: AbortSignal
  parentExecutionId?: string
}): Promise<{ signal: AbortSignal; dispose: () => void }> {
  const controller = new AbortController()

  if (params.parentSignal?.aborted) {
    controller.abort(params.parentSignal.reason)
    return { signal: controller.signal, dispose: () => {} }
  }

  const onParentAbort = () => controller.abort(params.parentSignal?.reason)
  params.parentSignal?.addEventListener('abort', onParentAbort, { once: true })

  let unsubscribe: (() => void) | undefined
  if (params.parentExecutionId) {
    const parentExecutionId = params.parentExecutionId
    // Subscribe BEFORE the durable read, mirroring `markExecutionCancelled`'s
    // write-durable-then-publish order: a cancel published during the read is
    // caught by the subscription, and one published earlier — while the child's
    // session and admission were still being set up — by the read itself. The
    // child's own engine backstop cannot cover this, since it checks the CHILD's
    // execution id, which is never the one marked cancelled.
    unsubscribe = getCancellationChannel().subscribe((event) => {
      if (event.executionId === parentExecutionId) controller.abort()
    })
    if (isRedisCancellationEnabled()) {
      try {
        if (await isExecutionCancelled(parentExecutionId)) controller.abort()
      } catch {
        // Fail open, matching the engine's own backstop: a failed read must not
        // stop a child whose parent was never actually cancelled.
      }
    }
  }

  return {
    signal: controller.signal,
    dispose: () => {
      params.parentSignal?.removeEventListener('abort', onParentAbort)
      unsubscribe?.()
    },
  }
}

/**
 * Child-session finalizations still in flight, keyed by the INVOKING run's
 * execution id.
 *
 * A cancelled or timed-out parent engine returns without draining its in-flight
 * node promises, so the custom-block handler's finalization would otherwise be
 * abandoned mid-write: the invoking run finishes, the worker tears down, and the
 * child's log row is left `running` until the stale-execution reaper sweeps it
 * minutes later. Registering here lets the run's own completion path await the
 * durable write instead of racing it.
 *
 * Only the immediate invoker is tracked. A finalization orphaned *below* another
 * abandoned child still falls back to the reaper.
 */
const pendingChildFinalizations = new Map<string, Set<Promise<unknown>>>()

/** Registers a child-session finalization against its invoking run. */
export function trackChildFinalization(
  invokerExecutionId: string | undefined,
  promise: Promise<unknown>
): void {
  if (!invokerExecutionId) return

  let pending = pendingChildFinalizations.get(invokerExecutionId)
  if (!pending) {
    pending = new Set()
    pendingChildFinalizations.set(invokerExecutionId, pending)
  }
  pending.add(promise)

  // Self-cleaning so an invoker that never drains cannot leak the entry. The
  // `catch` also marks the rejection handled — callers use `allSettled`.
  void promise
    .catch(() => {})
    .finally(() => {
      pending.delete(promise)
      if (pending.size === 0) pendingChildFinalizations.delete(invokerExecutionId)
    })
}

/** Awaits every child-session finalization registered for this run. */
export async function waitForChildFinalizations(
  invokerExecutionId: string | undefined
): Promise<void> {
  if (!invokerExecutionId) return

  const pending = pendingChildFinalizations.get(invokerExecutionId)
  if (!pending) return

  // Re-check: a settling finalization can register nothing further, but a
  // nested child can still be added while we await.
  while (pending.size > 0) {
    await Promise.allSettled([...pending])
  }
  pendingChildFinalizations.delete(invokerExecutionId)
}
