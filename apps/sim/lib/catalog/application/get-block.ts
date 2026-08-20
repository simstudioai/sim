import {
  isBlockVisibleToCaller,
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
  withCatalogBlockScope,
} from '@/lib/catalog/application/catalog-context'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { type CatalogBlockDetail, projectBlockDetail } from '@/lib/catalog/projection/block-detail'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBlock } from '@/blocks/registry'

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
      const block = getBlock(input.blockId)
      if (!block || !isBlockVisibleToCaller(block, gate)) return null
      return projectBlockDetail(block)
    })

    if (!detail) throw new OrchestrationError('not_found', 'Block not found')
    return { block: detail }
  },
})
