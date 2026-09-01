import {
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
} from '@/lib/catalog/application/catalog-context'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { resolveVisibleToolId, resolveVisibleToolIds } from '@/lib/catalog/application/tool-scope'
import { type CatalogToolDetail, projectToolDetail } from '@/lib/catalog/projection/tool'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface GetCatalogToolInput {
  workspaceId: string
  toolId: string
}

export interface GetCatalogToolResult {
  tool: CatalogToolDetail
}

/**
 * One built-in tool's parameters and outputs.
 *
 * An unversioned name resolves to the newest version this caller can see, the
 * way the block detail read does, and the returned `id` is the resolved one so
 * a caller can see which version answered. Resolving through
 * `@/tools/tool-ids` instead would answer with the superseded v1 that stays
 * registered for execution's sake, which no visible block exposes — so every
 * versioned family 404'd on the base name. A tool the workspace's blocks do not
 * expose answers 404 rather than 403, for the same enumeration reason as the
 * block detail read.
 */
export const getCatalogTool = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.readTool,
  resolveContext: ({ input }: { input: GetCatalogToolInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<GetCatalogToolResult> => {
    const gate = await resolveCatalogGate(principal, context)
    const visibleToolIds = await resolveVisibleToolIds(gate)
    const resolvedToolId = resolveVisibleToolId(input.toolId, visibleToolIds)
    if (!visibleToolIds.has(resolvedToolId)) {
      throw new OrchestrationError('not_found', 'Tool not found')
    }

    const tool = projectToolDetail(resolvedToolId, { hostedKeys: isHosted })
    if (!tool) throw new OrchestrationError('not_found', 'Tool not found')

    return { tool }
  },
})
