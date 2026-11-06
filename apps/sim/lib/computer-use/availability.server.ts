import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/** Computer use rolls out by organization; personal workspaces follow the global switch. */
export function isComputerUseAvailable(orgId?: string | null): Promise<boolean> {
  return isFeatureEnabled('mothership-computer-use', orgId ? { orgId } : {})
}
