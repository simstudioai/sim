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
 * The source workspace's payer has no headroom for this custom-block child run.
 *
 * Boundary-safe: publishing and invocation are both gated on a single
 * organization, so the exhausted limit always belongs to the consumer's own org.
 * Surfacing it lets them act on it instead of seeing an opaque failure.
 */
export class CustomBlockAdmissionError extends BoundarySafeError {
  constructor(message: string) {
    super({ message, errorType: 'usage_limit' })
    this.name = 'CustomBlockAdmissionError'
  }
}

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
  if (usage.isExceeded) {
    throw new CustomBlockAdmissionError(usage.message ?? 'Workspace usage limit exceeded')
  }
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
