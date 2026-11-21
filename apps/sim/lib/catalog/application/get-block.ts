import { catalogDelegationPolicy } from '@/lib/catalog/application/authorization'
import {
  isBlockVisibleToCaller,
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
  withCatalogBlockScope,
} from '@/lib/catalog/application/context'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { type CatalogBlockDetail, projectBlockDetail } from '@/lib/catalog/projection/block-detail'
import { getContainerBlockDetail } from '@/lib/catalog/projection/container-blocks'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBlock, getLatestBlockForViewer } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

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
 * enumerate unrevealed blocks one id at a time. The one exception is a sunset
 * (legacy or deprecated) block hidden only for its lifecycle: placed instances
 * keep running, so it reads by its exact id (`starter`), its description leading
 * with the block that replaces it (`start_trigger`). An exact id that is also a
 * base type with a visible newer version (`cursor`, beside `cursor_v3`) reads
 * as that version, the name the list publishes it under, and the response
 * echoes the resolved id.
 */
export const getCatalogBlock = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.readBlock,
  resolveContext: ({ input }: { input: GetCatalogBlockInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: { delegation: catalogDelegationPolicy },
  execute: async ({ principal, input, context }): Promise<GetCatalogBlockResult> => {
    const gate = await resolveCatalogGate(principal, context, { customBlockInputs: true })

    const detail = await withCatalogBlockScope(gate, async () => {
      // Containers (loop/parallel) are authorable types outside the registry;
      // the catalog answers for the same vocabulary add_block accepts.
      const container = getContainerBlockDetail(input.blockId)
      if (container) return container
      const project = (block: BlockConfig) =>
        projectBlockDetail(block, { deployment: { hostedKeys: isHosted } })
      const latest = getLatestBlockForViewer(input.blockId)
      if (latest) return isBlockVisibleToCaller(latest, gate) ? project(latest) : null
      const sunset = getBlock(input.blockId)
      if (!sunset?.sunset || !isBlockVisibleToCaller(sunset, gate, { includeSunset: true })) {
        return null
      }
      return project(sunset)
    })

    if (!detail) throw new OrchestrationError('not_found', 'Block not found')
    return { block: detail }
  },
})
