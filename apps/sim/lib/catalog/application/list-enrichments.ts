import { loadCatalogWorkspaceContext } from '@/lib/catalog/application/catalog-context'
import {
  matchesCatalogSearch,
  normalizeCatalogSearch,
} from '@/lib/catalog/application/catalog-page'
import { catalogOperations } from '@/lib/catalog/application/operations'
import { type CatalogEnrichment, projectEnrichment } from '@/lib/catalog/projection/enrichment'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { ALL_ENRICHMENTS } from '@/enrichments/registry'

export interface ListCatalogEnrichmentsInput {
  workspaceId: string
  search?: string
}

export interface ListCatalogEnrichmentsResult {
  enrichments: CatalogEnrichment[]
}

/**
 * Every table enrichment, in catalog order.
 *
 * One page, for the same reason as the connector types: the set is the
 * code-defined enrichment registry, bounded by construction rather than by a
 * caller's page size.
 */
export const listCatalogEnrichments = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.listEnrichments,
  resolveContext: ({ input }: { input: ListCatalogEnrichmentsInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ input }): Promise<ListCatalogEnrichmentsResult> => {
    const search = normalizeCatalogSearch(input.search)
    return {
      enrichments: ALL_ENRICHMENTS.map(projectEnrichment).filter((enrichment) =>
        matchesCatalogSearch(search, enrichment.name)
      ),
    }
  },
})
