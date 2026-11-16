import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Code-first workflows (the SDK block catalog, workflow source read and apply, the Code tab) ship
 * behind one global `workflow-code` flag; every surface of the feature gates through here.
 */
export function isWorkflowCodeEnabled(): Promise<boolean> {
  return isFeatureEnabled('workflow-code')
}

export async function requireWorkflowCodeEnabled(): Promise<void> {
  if (!(await isWorkflowCodeEnabled())) {
    throw new OrchestrationError('forbidden', 'Code-first workflows are not enabled')
  }
}
