import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { useWorkspaceUsageGate } from '@/hooks/queries/workspace-usage'

interface UseUsageLimitsOptions {
  workspaceId: string
}

/**
 * Exposes the routed workspace's payer/member execution gate.
 */
export function useUsageLimits({ workspaceId }: UseUsageLimitsOptions) {
  const { billingEnabled } = useDeploymentShape()
  const { data, isLoading } = useWorkspaceUsageGate(billingEnabled ? workspaceId : undefined)

  return {
    usageExceeded: data?.isExceeded ?? false,
    message: data?.message ?? null,
    scope: data?.scope ?? null,
    isLoading,
  }
}
