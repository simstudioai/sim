import type { BlockConfig } from '@/blocks/types'
import type { PermissionGroupEditorCatalog } from '@/ee/access-control/lib/editor-catalog-model'
import { KNOWLEDGE_CONNECTOR_OPTIONS } from '@/ee/access-control/lib/editor-registry'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getStaticProviderModels,
  NAMESPACED_MODEL_PROVIDERS,
  PROVIDER_DEFINITIONS,
} from '@/providers/models'
import { getAllProviderIds } from '@/providers/utils'
import { getToolMetadata } from '@/tools/metadata'

/** The same editor options for a viewer's visible block universe and for the isolated design fixture. */
export function projectPermissionGroupCatalog(
  universe: BlockConfig[]
): PermissionGroupEditorCatalog {
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
          sunset: model.sunset?.status ?? null,
        })),
      }
    }),
    knowledgeConnectors: KNOWLEDGE_CONNECTOR_OPTIONS,
  }
}
