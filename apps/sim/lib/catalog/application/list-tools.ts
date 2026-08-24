import type { V2SortOrder } from '@/lib/api/contracts/v2/shared'
import {
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
} from '@/lib/catalog/application/catalog-context'
import {
  type CatalogPage,
  matchesCatalogSearch,
  normalizeCatalogSearch,
  sortCatalogEntries,
  takeCatalogPage,
} from '@/lib/catalog/application/catalog-page'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { resolveVisibleToolIds } from '@/lib/catalog/application/tool-scope'
import { type CatalogToolSummary, projectToolSummaryById } from '@/lib/catalog/projection/tool'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { isHosted } from '@/lib/core/config/env-flags'
import type { HostedApiKeySupport } from '@/tools/hosted-api-key'
import { getToolIds } from '@/tools/tool-ids'

export interface ListCatalogToolsInput {
  workspaceId: string
  search?: string
  hostedApiKey?: HostedApiKeySupport
  oauthProvider?: string
  sortBy: 'id' | 'name'
  sortOrder: V2SortOrder
  offset: number
  limit: number
}

export type ListCatalogToolsResult = CatalogPage<CatalogToolSummary>

const SORT_FIELDS: Record<ListCatalogToolsInput['sortBy'], (tool: CatalogToolSummary) => string> = {
  id: (tool) => tool.id,
  name: (tool) => tool.name,
}

/**
 * The built-in tools this caller may run in this workspace.
 *
 * Built-in tools only. A workspace's MCP tools are discovered live per server
 * and live on `GET /api/v2/mcp-servers/{mcpServerId}/tools`; its code-backed custom tools
 * are a CRUD resource on `GET /api/v2/custom-tools`. Three resources with three
 * lifecycles, deliberately not unioned.
 */
export const listCatalogTools = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.listTools,
  resolveContext: ({ input }: { input: ListCatalogToolsInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<ListCatalogToolsResult> => {
    const search = normalizeCatalogSearch(input.search)
    const oauthProvider = input.oauthProvider?.trim().toLowerCase()
    const gate = await resolveCatalogGate(principal, context)
    const visibleToolIds = await resolveVisibleToolIds(gate)

    const summaries: CatalogToolSummary[] = []
    /** `getToolIds()` hands out a frozen array — read it, never reorder it in place. */
    for (const toolId of getToolIds()) {
      if (!visibleToolIds.has(toolId)) continue
      const summary = projectToolSummaryById(toolId, { hostedKeys: isHosted })
      if (!summary) continue
      if (input.hostedApiKey && summary.hostedApiKey !== input.hostedApiKey) continue
      if (oauthProvider && summary.oauth?.provider.toLowerCase() !== oauthProvider) continue
      if (!matchesCatalogSearch(search, summary.id, summary.name, summary.description)) continue
      summaries.push(summary)
    }

    return takeCatalogPage(
      sortCatalogEntries(summaries, SORT_FIELDS[input.sortBy], input.sortOrder),
      input.offset,
      input.limit
    )
  },
})
