import {
  v2GetBlockContract,
  v2GetToolContract,
  v2ListBlocksContract,
  v2ListConnectorTypesContract,
  v2ListToolsContract,
} from '@/lib/api/contracts/v2/catalog'

/** Catalog contract paths in the generated route table's `{param}` pattern syntax. */
const CATALOG_ROUTE_PATTERNS: ReadonlySet<string> = new Set(
  [
    v2ListBlocksContract,
    v2GetBlockContract,
    v2ListToolsContract,
    v2GetToolContract,
    v2ListConnectorTypesContract,
  ].map((contract) => contract.path.replace(/\[([^\]]+)\]/g, '{$1}'))
)

/**
 * Whether a sandbox API request reads the producer-owned catalog (blocks, tools, connector
 * types): no execution output, file content, or row values, so no producer records secret
 * provenance for it and none is expected.
 */
export function isCatalogRoute(method: string, routePattern: string): boolean {
  return method === 'GET' && CATALOG_ROUTE_PATTERNS.has(routePattern)
}
