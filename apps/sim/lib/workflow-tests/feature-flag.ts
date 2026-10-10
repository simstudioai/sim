import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Test rollout follows the canonical organization; personal workspaces use the global switch. */
export function isWorkflowTestsEnabled(orgId?: string | null): Promise<boolean> {
  return isFeatureEnabled('workflow-tests', orgId ? { orgId } : {})
}

export async function requireWorkflowTestsEnabled(orgId?: string | null): Promise<void> {
  if (!(await isWorkflowTestsEnabled(orgId))) {
    throw new OrchestrationError('forbidden', 'Workflow tests are not enabled')
  }
}
