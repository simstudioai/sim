import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { useWorkspaceUsageGate } from '@/hooks/queries/workspace-usage'

interface UseUsageLimitsOptions {
  workspaceId: string
}

/**
 * Exposes the routed workspace's payer/member execution gate.
 */
export function useUsageLimits({ workspaceId }: UseUsageLimitsOptions) {
  const { data, isLoading } = useWorkspaceUsageGate(isBillingEnabled ? workspaceId : undefined)

  return {
    usageExceeded: data?.isExceeded ?? false,
    message: data?.message ?? null,
    scope: data?.scope ?? null,
    isLoading,
  }
}
