import {
  isBlockVisibleToCaller,
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
  withCatalogBlockScope,
} from '@/lib/catalog/application/catalog-context'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { type CatalogBlockDetail, projectBlockDetail } from '@/lib/catalog/projection/block-detail'
import { getContainerBlockDetail } from '@/lib/catalog/projection/container-blocks'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getLatestBlockForViewer } from '@/blocks/registry'

export interface GetCatalogBlockInput {
  workspaceId: string
  blockId: string
}

export interface GetCatalogBlockResult {
  block: CatalogBlockDetail
}

/**
 * One block's full authoring shape.
 *
 * An unversioned base type resolves to its newest version, exactly as the tool
 * detail read does — `confluence` answers with `confluence_v2` — and the
 * response echoes the resolved id. Without that, every one of the 34 versioned
 * families 404s on the name the list publishes it under.
 *
 * Every filter the list applies also produces a 404 here — an unknown type, a
 * block hidden from the toolbar, an unrevealed preview block, a kill-switched
 * one, a type this deployment does not ship, and one the workspace's permission
 * groups exclude all answer identically. Anything softer would let a caller
 * enumerate unrevealed blocks one id at a time.
 */
export const getCatalogBlock = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.readBlock,
  resolveContext: ({ input }: { input: GetCatalogBlockInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<GetCatalogBlockResult> => {
    const gate = await resolveCatalogGate(principal, context)

    const detail = await withCatalogBlockScope(gate, async () => {
      // Containers (loop/parallel) are authorable types outside the registry;
      // the catalog answers for the same vocabulary add_block accepts.
      const container = getContainerBlockDetail(input.blockId)
      if (container) return container
      const block = getLatestBlockForViewer(input.blockId)
      if (!block || !isBlockVisibleToCaller(block, gate)) return null
      return projectBlockDetail(block, { deployment: { hostedKeys: isHosted } })
    })

    if (!detail) throw new OrchestrationError('not_found', 'Block not found')
    return { block: detail }
  },
})
