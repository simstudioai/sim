import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import type { ResourceScope } from '@/lib/core/resource-scope'

/** Zoom Search rollout follows the canonical organization; authorization is checked separately. */
export async function isSearchProviderEnabled(
  provider: string,
  scope: ResourceScope
): Promise<boolean> {
  if (provider !== 'zoom') return true
  const orgId =
    scope.kind === 'organization'
      ? scope.organizationId
      : (
          await db
            .select({ organizationId: workspace.organizationId })
            .from(workspace)
            .where(eq(workspace.id, scope.workspaceId))
            .limit(1)
        )[0]?.organizationId
  if (!orgId) return false
  return isFeatureEnabled('zoom-search', { orgId })
}
