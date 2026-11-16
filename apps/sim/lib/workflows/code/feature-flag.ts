import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Workflows as code (the SDK block catalog, workflow source read and apply, the Code tab) ships
 * behind one global `workflow-code` flag; every surface of the feature gates through here.
 */
export function isWorkflowCodeEnabled(): Promise<boolean> {
  return isFeatureEnabled('workflow-code')
}

export async function requireWorkflowCodeEnabled(): Promise<void> {
  if (!(await isWorkflowCodeEnabled())) {
    throw new OrchestrationError(
      'forbidden',
      'Workflows as code is in preview and not enabled on this deployment'
    )
  }
}
