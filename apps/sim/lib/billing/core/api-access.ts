import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isPaid } from '@/lib/billing/plan-helpers'
import { isHosted } from '@/lib/core/config/feature-flags'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'

/**
 * Message for the 402 returned when a free-plan account attempts programmatic
 * workflow execution (API key, public API, MCP server, or A2A agent server).
 */
export const API_EXECUTION_REQUIRES_PAID_PLAN_MESSAGE =
  'Programmatic workflow execution requires a paid plan. Upgrade to Pro or higher to use the API.'

/**
 * Whether `userId` may run workflows programmatically. Always allowed on
 * self-hosted (no billing) and when no user is resolved; on hosted, requires a
 * paid plan.
 *
 * `getHighestPrioritySubscription` rolls up organization memberships, so a free
 * individual belonging to a paid org/workspace is entitled.
 */
export async function isApiExecutionEntitled(userId: string | undefined): Promise<boolean> {
  if (!isHosted || !userId) return true

  const subscription = await getHighestPrioritySubscription(userId)
  return isPaid(subscription?.plan)
}

/**
 * Workspace-scoped variant of {@link isApiExecutionEntitled} that gates on the
 * workspace's billed account. Short-circuits on self-hosted before any DB
 * lookup, so the billed-account query only runs on hosted.
 */
export async function isWorkspaceApiExecutionEntitled(
  workspaceId: string | undefined
): Promise<boolean> {
  if (!isHosted || !workspaceId) return true

  const billedUserId = await getWorkspaceBilledAccountUserId(workspaceId)
  return isApiExecutionEntitled(billedUserId ?? undefined)
}
