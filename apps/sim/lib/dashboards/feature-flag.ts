import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Dashboard rollout follows the canonical organization; personal workspaces use the global switch. */
export function isDashboardsEnabled(orgId?: string | null): Promise<boolean> {
  return isFeatureEnabled('dashboards', orgId ? { orgId } : {})
}

export async function requireDashboardsEnabled(orgId?: string | null): Promise<void> {
  if (!(await isDashboardsEnabled(orgId))) {
    throw new OrchestrationError('forbidden', 'Dashboards are not enabled')
  }
}
