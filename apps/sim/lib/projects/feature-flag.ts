import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/** The project view rollout follows the canonical organization; personal workspaces use the global switch. */
export function isOrgProjectViewEnabled(orgId?: string | null): Promise<boolean> {
  return isFeatureEnabled('org-project-view', orgId ? { orgId } : {})
}
