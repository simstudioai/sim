import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Project rollout is a global switch; it never varies by organization or user. */
export function isProjectsEnabled(): Promise<boolean> {
  return isFeatureEnabled('projects')
}

export async function requireProjectApiEnabled(): Promise<void> {
  if (!(await isProjectsEnabled())) {
    throw new OrchestrationError('forbidden', 'Projects are not enabled')
  }
}
