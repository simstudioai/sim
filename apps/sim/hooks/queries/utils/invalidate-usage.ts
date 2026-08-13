import type { QueryClient } from '@tanstack/react-query'
import { subscriptionKeys } from '@/hooks/queries/utils/subscription-keys'
import { workspaceUsageKeys } from '@/hooks/queries/utils/workspace-usage-keys'

/**
 * Usage is written asynchronously as a run settles, so a refetch fired on completion
 * races the write and re-reads the old balance.
 */
const USAGE_SETTLE_DELAY_MS = 1000

/**
 * Invalidates the workspace credit/usage reads after anything that moves the balance —
 * a run that spends credits, a top-up, a plan change, or a usage-limit edit. Both
 * families are keyed per workspace but derive from the same billing account, so the
 * family prefixes (not a single workspace's key) are what has to be refetched.
 */
export function invalidateWorkspaceUsage(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: workspaceUsageKeys.creditAvailabilities() }),
    queryClient.invalidateQueries({ queryKey: workspaceUsageKeys.gates() }),
  ])
}

/**
 * Refreshes the billing reads a run touches, after {@link USAGE_SETTLE_DELAY_MS}.
 *
 * Shared by the surfaces that spend credits — workflow execution and wand generation —
 * so the delay and the key set stay in one place.
 */
export function scheduleUsageRefresh(queryClient: QueryClient) {
  setTimeout(() => {
    void queryClient.invalidateQueries({ queryKey: subscriptionKeys.users() })
    void invalidateWorkspaceUsage(queryClient)
  }, USAGE_SETTLE_DELAY_MS)
}
