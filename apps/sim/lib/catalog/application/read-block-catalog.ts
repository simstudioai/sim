import {
  isBlockVisibleToCaller,
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
  withCatalogBlockScope,
} from '@/lib/catalog/application/catalog-context'
import { sortCatalogEntries } from '@/lib/catalog/application/catalog-page'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { projectBlockDetail } from '@/lib/catalog/projection/block-detail'
import { CONTAINER_BLOCK_DETAILS } from '@/lib/catalog/projection/container-blocks'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { isHosted } from '@/lib/core/config/env-flags'
import { getAllBlocks } from '@/blocks/registry'

interface ReadBlockCatalogInput {
  workspaceId: string
}

/** Current authorable block details for internal search, using one authorized catalog scope. */
export const readBlockCatalog = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.readBlock,
  resolveContext: ({ input }: { input: ReadBlockCatalogInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, context }) => {
    const gate = await resolveCatalogGate(principal, context)
    return withCatalogBlockScope(gate, async () => ({
      blocks: sortCatalogEntries(
        [
          ...getAllBlocks()
            .filter((block) => !block.sunset && isBlockVisibleToCaller(block, gate))
            .map((block) => projectBlockDetail(block, { deployment: { hostedKeys: isHosted } })),
          ...Object.values(CONTAINER_BLOCK_DETAILS),
        ],
        (block) => block.id,
        'asc'
      ),
    }))
  },
})
