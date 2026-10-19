import { readMidRunUsageVerdict } from '@/lib/billing/core/mid-run-usage'
import { NEAR_LIMIT_USAGE_GATE_TTL_MS } from '@/lib/billing/core/usage-gate-cache'
import { isPaid } from '@/lib/billing/plan-helpers'
import { resolveUsageUpgradePayload } from '@/lib/billing/usage-upgrade'
import { markFailureKind } from '@/lib/core/errors/failure-log'
import { NonRetryableExecutionError } from '@/lib/execution/non-retryable-error'
import { attachTrustedExecutionCost } from '@/executor/utils/errors'
import type { ModelCost } from '@/providers/cost-policy'
import type { TokenUsageCost } from '@/providers/pricing'
import type { ProviderRuntimeContext } from '@/providers/runtime-context'

/**
 * A run stopped at its payer's usage limit. Providers pass it through unwrapped (see
 * `isConversationContextError`), so it keeps its billed cost and is never retried.
 */
export class RunUsageLimitError extends NonRetryableExecutionError {
  constructor(message: string) {
    super(message)
    this.name = 'RunUsageLimitError'
  }
}

export function addSettledCost(settledCost: TokenUsageCost, cost: TokenUsageCost): void {
  settledCost.input += cost.input
  settledCost.output += cost.output
  settledCost.total += cost.total
}

/**
 * Adds a settled model step's billed cost to its request's and its run's running totals. Tool
 * costs reach only the request's: a workflow tool's child already spends against the run's.
 */
export function recordModelStepCost(
  runtime: ProviderRuntimeContext | undefined,
  cost: ModelCost
): void {
  if (!runtime) return
  if (runtime.settledCost) addSettledCost(runtime.settledCost, cost)
  const unrecorded = runtime.executionContext?.unrecordedModelCost
  if (unrecorded) unrecorded.total += cost.total
}

/**
 * Stops a free-plan workflow run before its next model call once the payer's recorded usage plus
 * the run's own unrecorded model spend reaches its limit. A run's cost reaches the ledger only
 * with its log, so admission alone would let one run keep calling models long past the limit,
 * and a free plan's spend past its limit is never billed. A paid payer's overshoot is billed as
 * overage, so its runs are left to admission and never read here.
 *
 * Reads nothing until the run has spent, then the cached execution gate. A gate that cannot
 * answer, or an account that is blocked, lets the run continue and is not read again for
 * {@link NEAR_LIMIT_USAGE_GATE_TTL_MS}: the next admission refuses it. The stop is not retried,
 * it carries the cost of the request's settled steps and tool calls so the stopped block is
 * billed for them, and it is attributed to the user so it logs at info, not error.
 */
export async function assertRunWithinUsageLimit(
  runtime: ProviderRuntimeContext | undefined
): Promise<void> {
  const executionContext = runtime?.executionContext
  if (!runtime || !executionContext) return
  const attribution = executionContext.metadata.billingAttribution
  const unrecorded = executionContext.unrecordedModelCost
  if (
    !attribution ||
    !unrecorded ||
    unrecorded.total <= 0 ||
    isPaid(attribution.payerSubscription?.plan) ||
    executionContext.abortSignal?.aborted ||
    Date.now() < (unrecorded.readDeferredUntil ?? 0)
  ) {
    return
  }

  const verdict = await readMidRunUsageVerdict(attribution, unrecorded.total)
  // A run cancelled during the read keeps its cancellation; the provider call then aborts.
  if (verdict.status === 'within' || executionContext.abortSignal?.aborted) return
  if (verdict.status !== 'exceeded') {
    unrecorded.readDeferredUntil = Date.now() + NEAR_LIMIT_USAGE_GATE_TTL_MS
    return
  }

  const { message } = await resolveUsageUpgradePayload(
    attribution.actorUserId,
    verdict.payer ?? attribution,
    verdict.scope
  )
  const error = markFailureKind(new RunUsageLimitError(message), 'user')
  if (runtime.settledCost?.total) attachTrustedExecutionCost(error, runtime.settledCost)
  throw error
}
