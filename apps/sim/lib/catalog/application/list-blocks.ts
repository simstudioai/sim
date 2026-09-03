import type { V2SortOrder } from '@/lib/api/contracts/v2/shared'
import {
  isBlockVisibleToCaller,
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
  withCatalogBlockScope,
} from '@/lib/catalog/application/catalog-context'
import {
  type CatalogPage,
  matchesCatalogSearch,
  normalizeCatalogSearch,
  sortCatalogEntries,
  takeCatalogPage,
} from '@/lib/catalog/application/catalog-page'
import { catalogOperations } from '@/lib/catalog/application/operations'
import {
  type CatalogBlockSummary,
  projectBlockSummary,
} from '@/lib/catalog/projection/block-summary'
import { CONTAINER_BLOCK_SUMMARIES } from '@/lib/catalog/projection/container-blocks'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { getAllBlocks } from '@/blocks/registry'

export interface ListCatalogBlocksInput {
  workspaceId: string
  search?: string
  category?: 'blocks' | 'tools' | 'triggers'
  capability?: 'trigger'
  source?: 'builtin' | 'custom'
  /** Whether `legacy` / `deprecated` blocks appear. Off by default. */
  includeSunset?: boolean
  sortBy: 'id' | 'name' | 'category'
  sortOrder: V2SortOrder
  offset: number
  limit: number
}

export type ListCatalogBlocksResult = CatalogPage<CatalogBlockSummary>

const SORT_FIELDS: Record<
  ListCatalogBlocksInput['sortBy'],
  (block: CatalogBlockSummary) => string
> = {
  id: (block) => block.id,
  name: (block) => block.name,
  category: (block) => block.category,
}

function matchesFilters(block: CatalogBlockSummary, input: ListCatalogBlocksInput): boolean {
  if (input.category && block.category !== input.category) return false
  if (input.capability === 'trigger' && !block.triggerCapable) return false
  if (input.source && block.source !== input.source) return false
  if (!input.includeSunset && block.sunset !== undefined) return false
  return true
}

/**
 * The blocks this caller may place in this workspace.
 *
 * Built-in and custom blocks are one list on purpose: a workflow references
 * either by `type`, so "what may I place?" must be answerable in one call. The
 * `source` field tells them apart, and `capability=trigger` narrows to the
 * blocks that can start a workflow rather than needing a second endpoint.
 *
 * A sunset block (`legacy` or `deprecated`) is left out unless `includeSunset`
 * is set: it stays readable by id and keeps executing where it is already
 * placed, but a list of "what may I place?" must not offer a superseded block
 * alongside its replacement.
 *
 * No audit is projected — reading a catalog is not a semantic event, and no
 * shipped v2 read records one.
 */
export const listCatalogBlocks = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.listBlocks,
  resolveContext: ({ input }: { input: ListCatalogBlocksInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<ListCatalogBlocksResult> => {
    const search = normalizeCatalogSearch(input.search)
    const gate = await resolveCatalogGate(principal, context)

    const summaries = await withCatalogBlockScope(gate, async () => [
      ...getAllBlocks()
        .filter((block) =>
          isBlockVisibleToCaller(block, gate, { includeSunset: input.includeSunset === true })
        )
        .map(projectBlockSummary),
      // Containers are authorable types (add_block accepts them) that live outside
      // the registry — the catalog speaks the same vocabulary as authoring.
      ...CONTAINER_BLOCK_SUMMARIES,
    ])

    const filtered = summaries.filter(
      (block) =>
        matchesFilters(block, input) &&
        matchesCatalogSearch(search, block.id, block.name, block.description)
    )

    return takeCatalogPage(
      sortCatalogEntries(filtered, SORT_FIELDS[input.sortBy], input.sortOrder),
      input.offset,
      input.limit
    )
  },
})
