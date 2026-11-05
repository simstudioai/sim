import type { PermissionGroupEditorCatalog } from '@/lib/api/contracts/permission-groups'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import {
  getCustomBlockRowsForOrg,
  isCustomBlocksEligibleForOrganization,
} from '@/lib/workflows/custom-blocks/operations'
import { withCustomBlockOverlay } from '@/blocks/custom/server-overlay'
import { withBlockVisibility } from '@/blocks/visibility/server-context'
import {
  getAccessControlBlockUniverse,
  KNOWLEDGE_CONNECTOR_OPTIONS,
} from '@/ee/access-control/lib/editor-registry'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getModelSunsetStatus,
  getStaticProviderModels,
  NAMESPACED_MODEL_PROVIDERS,
  PROVIDER_DEFINITIONS,
} from '@/providers/models'
import { getAllProviderIds } from '@/providers/utils'
import { getToolMetadata } from '@/tools/metadata'

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
  const staticModelIds = (providerId: string) =>
    new Set(getStaticProviderModels(providerId).map((model) => model.id))

  return {
    blocks: universe.map((block) => ({
      type: block.type,
      name: block.name,
      description: block.description,
      category: block.category,
      hidden: Boolean(block.hideFromToolbar),
      sourceWorkspaceName: block.sourceWorkspaceName ?? null,
      tools: (block.tools?.access ?? []).map((id) => ({
        id,
        label: getToolMetadata(id)?.name ?? id,
      })),
    })),
    providerIds: getAllProviderIds(),
    dynamicProviderIds: [...DYNAMIC_MODEL_PROVIDERS],
    providers: Object.entries(PROVIDER_DEFINITIONS).map(([id, definition]) => {
      const fromStaticCatalog = staticModelIds(id)
      return {
        id,
        name: definition.name,
        namespaced: NAMESPACED_MODEL_PROVIDERS.has(id),
        modelPatterns: (definition.modelPatterns ?? []).map(({ source, flags }) => ({
          source,
          flags,
        })),
        models: definition.models.map((model) => ({
          id: model.id,
          inStaticCatalog: fromStaticCatalog.has(model.id),
          deprecated: model.sunset?.status === 'deprecated',
          sunset: getModelSunsetStatus(model.id) ?? null,
        })),
      }
    }),
    knowledgeConnectors: KNOWLEDGE_CONNECTOR_OPTIONS,
  }
}
