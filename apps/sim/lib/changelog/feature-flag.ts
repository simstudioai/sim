import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Changelog rollout follows the canonical organization; personal workspaces use the global switch. */
export function isChangelogEnabled(orgId?: string | null): Promise<boolean> {
  return isFeatureEnabled('changelog', orgId ? { orgId } : {})
}

export async function requireChangelogEnabled(orgId?: string | null): Promise<void> {
  if (!(await isChangelogEnabled(orgId))) {
    throw new OrchestrationError('forbidden', 'The changelog is not enabled')
  }
}
