import {
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
} from '@/lib/catalog/application/catalog-context'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { resolveVisibleToolIds } from '@/lib/catalog/application/tool-scope'
import { type CatalogToolDetail, projectToolDetail } from '@/lib/catalog/projection/tool'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveToolId } from '@/tools/tool-ids'

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
 * An unversioned name resolves to the newest version exactly as execution does,
 * and the returned `id` is the resolved one so a caller can see which version
 * answered. A tool the workspace's blocks do not expose answers 404 rather than
 * 403, for the same enumeration reason as the block detail read.
 */
export const getCatalogTool = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.readTool,
  resolveContext: ({ input }: { input: GetCatalogToolInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<GetCatalogToolResult> => {
    const resolvedToolId = resolveToolId(input.toolId)
    const tool = projectToolDetail(resolvedToolId, { hostedKeys: isHosted })
    if (!tool) throw new OrchestrationError('not_found', 'Tool not found')

    const gate = await resolveCatalogGate(principal, context)
    const visibleToolIds = await resolveVisibleToolIds(gate)
    if (!visibleToolIds.has(resolvedToolId)) {
      throw new OrchestrationError('not_found', 'Tool not found')
    }

    return { tool }
  },
})
