import type { V2ConnectorTypeDetail } from '@/lib/api/contracts/v2/catalog'
import { loadCatalogWorkspaceContext } from '@/lib/catalog/application/catalog-context'
import {
  type CatalogPage,
  matchesCatalogSearch,
  normalizeCatalogSearch,
  takeCatalogPage,
} from '@/lib/catalog/application/catalog-page'
import { catalogOperations } from '@/lib/catalog/application/operations'
import {
  type CatalogConnectorType,
  type CatalogConnectorTypeSummary,
  projectConnectorType,
  toConnectorTypeSummary,
} from '@/lib/catalog/projection/connector-type'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

export interface ListCatalogConnectorTypesInput {
  workspaceId: string
  search?: string
  /** `summary` unless the caller asked for the configuration schema. */
  detail: V2ConnectorTypeDetail
  limit: number
  offset: number
}

export type ListCatalogConnectorTypesResult = CatalogPage<
  CatalogConnectorType | CatalogConnectorTypeSummary
>

/**
 * Knowledge-base connector types, in registry order, one page at a time.
 *
 * The set is bounded by the code-defined connector registry rather than by
 * workspace content, but bounded is not small: every type with its full config
 * schema ran to well over 100 KB, so the list pages and projects a summary
 * unless `detail` asks for the schema. Nothing gates a connector type per
 * workspace today, but the operation is still workspace-scoped — retrofitting
 * a required parameter onto a shipped v2 contract is a breaking change, and
 * one parameter now is cheap.
 */
export const listCatalogConnectorTypes = defineAuthorizedWorkspaceUseCase({
  operation: catalogOperations.listConnectorTypes,
  resolveContext: ({ input }: { input: ListCatalogConnectorTypesInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ input }): Promise<ListCatalogConnectorTypesResult> => {
    const search = normalizeCatalogSearch(input.search)
    const connectorTypes: Array<CatalogConnectorType | CatalogConnectorTypeSummary> = []
    for (const [connectorType, meta] of Object.entries(CONNECTOR_META_REGISTRY)) {
      const projected = projectConnectorType(connectorType, meta)
      if (!matchesCatalogSearch(search, projected.name)) continue
      connectorTypes.push(input.detail === 'full' ? projected : toConnectorTypeSummary(projected))
    }
    return takeCatalogPage(connectorTypes, input.offset, input.limit)
  },
})
