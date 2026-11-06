import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import {
  getCustomBlockRowsForOrg,
  isCustomBlocksEligibleForOrganization,
} from '@/lib/workflows/custom-blocks/operations'
import { withCustomBlockOverlay } from '@/blocks/custom/server-overlay'
import { withBlockVisibility } from '@/blocks/visibility/server-context'
import type { PermissionGroupEditorCatalog } from '@/ee/access-control/lib/editor-catalog-model'
import { projectPermissionGroupCatalog } from '@/ee/access-control/lib/editor-catalog-projection'
import { getAccessControlBlockUniverse } from '@/ee/access-control/lib/editor-registry'
/**
 * What the permission group editor needs from the block and provider registries, for a surface that
 * does not bundle them.
 *
 * Every allowlist row is returned whoever is asking: a viewer-filtered universe silently drops
 * allowlist entries on the next save. A row gated for this viewer carries `hidden`, which decides
 * only whether it is drawn, the same split the registry's clone-not-remove projection makes.
 */
export async function buildPermissionGroupEditorCatalog(context: {
  organizationId: string
  userId: string
}): Promise<PermissionGroupEditorCatalog> {
  const [visibility, customBlockRows] = await Promise.all([
    getBlockVisibility({ userId: context.userId, orgId: context.organizationId }),
    isCustomBlocksEligibleForOrganization(context.organizationId).then((eligible) =>
      eligible ? getCustomBlockRowsForOrg(context.organizationId) : []
    ),
  ])
  const universe = await withBlockVisibility(visibility, () =>
    withCustomBlockOverlay(customBlockRows, async () => getAccessControlBlockUniverse())
  )
  return projectPermissionGroupCatalog(universe)
}
