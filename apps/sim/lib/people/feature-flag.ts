import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export function isPeopleEnabled(organizationId: string): Promise<boolean> {
  return isFeatureEnabled('people', { orgId: organizationId })
}

export async function requirePeopleEnabled(organizationId: string): Promise<void> {
  if (!(await isPeopleEnabled(organizationId))) {
    throw new OrchestrationError('forbidden', 'People is not enabled for this organization')
  }
}
