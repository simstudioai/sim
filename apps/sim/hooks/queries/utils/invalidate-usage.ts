import type { QueryClient } from '@tanstack/react-query'
import { subscriptionKeys } from '@/hooks/queries/utils/subscription-keys'
import { workspaceUsageKeys } from '@/hooks/queries/utils/workspace-usage-keys'

/**
 * Usage is written asynchronously as a run settles, so a refetch fired on completion
 * races the write and re-reads the old balance.
 */
const USAGE_SETTLE_DELAY_MS = 1000

/**
 * Invalidates the workspace credit/usage reads after anything that moves the balance.
 * Both families are keyed per workspace but derive from one billing account, so the
 * family prefixes are what must refetch.
 */
export function invalidateWorkspaceUsage(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: workspaceUsageKeys.creditAvailabilities() }),
    queryClient.invalidateQueries({ queryKey: workspaceUsageKeys.gates() }),
  ])
}

/**
 * Refreshes the billing reads a run touches, after {@link USAGE_SETTLE_DELAY_MS}.
 * Shared by workflow execution and wand generation.
 */
export function scheduleUsageRefresh(queryClient: QueryClient) {
  setTimeout(() => {
    void queryClient.invalidateQueries({ queryKey: subscriptionKeys.users() })
    void invalidateWorkspaceUsage(queryClient)
  }, USAGE_SETTLE_DELAY_MS)
}
