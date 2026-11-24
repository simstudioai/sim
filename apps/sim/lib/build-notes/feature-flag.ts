import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Build notes roll out by organization; personal workspaces follow the global switch. */
export function isBuildNotesEnabled(orgId?: string | null): Promise<boolean> {
  return isFeatureEnabled('build-notes', orgId ? { orgId } : {})
}

/** Throws `forbidden` unless build notes are rolled out for the organization. */
export async function requireBuildNotesEnabled(orgId?: string | null): Promise<void> {
  if (!(await isBuildNotesEnabled(orgId))) {
    throw new OrchestrationError('forbidden', 'Build notes are not enabled')
  }
}
