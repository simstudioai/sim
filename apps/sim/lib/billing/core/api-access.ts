import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isPaid } from '@/lib/billing/plan-helpers'
import { isBillingEnabled, isFreeApiDeploymentGateEnabled } from '@/lib/core/config/env-flags'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'

/** The programmatic-execution paywall is active only when billing is enforced AND the gate flag is on. */
function isApiExecutionGateActive(): boolean {
  return isBillingEnabled && isFreeApiDeploymentGateEnabled
}

/**
 * Message for the 402 returned when a free-plan account attempts programmatic
 * workflow execution (API key, public API, or MCP server).
 */
export const API_EXECUTION_REQUIRES_PAID_PLAN_MESSAGE =
  'Programmatic workflow execution requires a paid plan. Upgrade to Pro or higher to use the API.'

/**
 * Whether `userId` may run workflows programmatically. Always allowed when
 * billing enforcement is off (self-hosted / `BILLING_ENABLED` unset) and when no
 * user is resolved; otherwise requires a paid plan.
 *
 * `getHighestPrioritySubscription` rolls up organization memberships, so a free
 * individual belonging to a paid org/workspace is entitled.
 */
export async function isApiExecutionEntitled(userId: string | undefined): Promise<boolean> {
  if (!isApiExecutionGateActive() || !userId) return true

  const subscription = await getHighestPrioritySubscription(userId)
  return isPaid(subscription?.plan)
}

/**
 * Workspace-scoped variant of {@link isApiExecutionEntitled} that gates on the
 * workspace's billed account. Short-circuits when billing is off before any DB
 * lookup, so the billed-account query only runs when billing is enforced.
 */
export async function isWorkspaceApiExecutionEntitled(
  workspaceId: string | undefined
): Promise<boolean> {
  if (!isApiExecutionGateActive() || !workspaceId) return true

  const billedUserId = await getWorkspaceBilledAccountUserId(workspaceId)
  return isApiExecutionEntitled(billedUserId ?? undefined)
}
