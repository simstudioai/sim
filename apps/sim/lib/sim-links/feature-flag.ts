import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export function isSimLinksEnabled(organizationId: string): Promise<boolean> {
  return isFeatureEnabled('sim-links', { orgId: organizationId })
}

export async function requireSimLinksEnabled(organizationId: string): Promise<void> {
  if (!(await isSimLinksEnabled(organizationId))) {
    throw new OrchestrationError('forbidden', 'Sim links are not enabled for this organization')
  }
}
