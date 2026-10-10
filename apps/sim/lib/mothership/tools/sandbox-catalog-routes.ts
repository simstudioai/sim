import {
  v2GetBlockContract,
  v2GetToolContract,
  v2ListBlocksContract,
  v2ListConnectorTypesContract,
  v2ListToolsContract,
} from '@/lib/api/contracts/v2/catalog'
import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'

let catalogRoutePatterns: ReadonlySet<string> | undefined

/**
 * Whether a sandbox API request reads the producer-owned catalog (blocks, tools, connector
 * types): no execution output, file content, or row values, so no producer records secret
 * provenance for it and none is expected. Each contract resolves through the generated route
 * table, so a renamed path parameter cannot drift from the pattern `matchV2Route` reports.
 */
export function isCatalogRoute(method: string, routePattern: string): boolean {
  if (method !== 'GET') return false
  catalogRoutePatterns ??= new Set(
    [
      v2ListBlocksContract,
      v2GetBlockContract,
      v2ListToolsContract,
      v2GetToolContract,
      v2ListConnectorTypesContract,
    ].flatMap((contract) => {
      const pattern = matchV2Route(contract.path.replace(/\[[^\]]+\]/g, 'catalog-id'))?.pattern
      return pattern ? [pattern] : []
    })
  )
  return catalogRoutePatterns.has(routePattern)
}
