import { loadCatalogWorkspaceContext } from '@/lib/catalog/application/catalog-context'
import {
  matchesCatalogSearch,
  normalizeCatalogSearch,
} from '@/lib/catalog/application/catalog-page'
import { catalogOperations } from '@/lib/catalog/application/operations'
import {
  type CatalogConnectorType,
  projectConnectorType,
} from '@/lib/catalog/projection/connector-type'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

export interface ListCatalogConnectorTypesInput {
  workspaceId: string
  search?: string
}

export interface ListCatalogConnectorTypesResult {
  connectorTypes: CatalogConnectorType[]
}

/**
 * Every knowledge-base connector type, in registry order.
 *
 * Returned as one page: the set is bounded by the code-defined connector
 * registry rather than by workspace content, exactly as the credential-provider
 * catalog is. Nothing gates a connector type per workspace today, but the
 * operation is still workspace-scoped — retrofitting a required parameter onto
 * a shipped v2 contract is a breaking change, and one parameter now is cheap.
 */
export const listCatalogConnectorTypes = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.listConnectorTypes,
  resolveContext: ({ input }: { input: ListCatalogConnectorTypesInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ input }): Promise<ListCatalogConnectorTypesResult> => {
    const search = normalizeCatalogSearch(input.search)
    const connectorTypes: CatalogConnectorType[] = []
    for (const [connectorType, meta] of Object.entries(CONNECTOR_META_REGISTRY)) {
      const projected = projectConnectorType(connectorType, meta)
      if (!matchesCatalogSearch(search, projected.name)) continue
      connectorTypes.push(projected)
    }
    return { connectorTypes }
  },
})
