import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import { observeTableRowDelivery } from '@/lib/table/application/row-delivery-observer'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/**
 * The v2 table routes whose responses carry no cell values, keyed `METHOD pattern`.
 * Every other table route — including one added later — must report the provenance
 * of the rows it returns, or its result is withheld from the model.
 */
export const TABLE_ROUTES_WITHOUT_ROW_DATA: ReadonlySet<string> = new Set([
  'GET /api/v2/tables',
  'POST /api/v2/tables',
  'POST /api/v2/tables/bulk-delete',
  'GET /api/v2/tables/folders',
  'POST /api/v2/tables/folders',
  'PATCH /api/v2/tables/folders',
  'DELETE /api/v2/tables/folders',
  'POST /api/v2/tables/folders/restore',
  'POST /api/v2/tables/imports',
  'GET /api/v2/tables/imports/{importId}',
  'DELETE /api/v2/tables/imports/{importId}',
  'POST /api/v2/tables/imports/{importId}/complete',
  'POST /api/v2/tables/imports/{importId}/parts',
  'POST /api/v2/tables/move',
  'GET /api/v2/tables/{tableId}',
  'PATCH /api/v2/tables/{tableId}',
  'DELETE /api/v2/tables/{tableId}',
  'POST /api/v2/tables/{tableId}/cancel-runs',
  'POST /api/v2/tables/{tableId}/columns',
  'PATCH /api/v2/tables/{tableId}/columns',
  'DELETE /api/v2/tables/{tableId}/columns',
  'GET /api/v2/tables/{tableId}/dispatches',
  'POST /api/v2/tables/{tableId}/dispatches',
  'GET /api/v2/tables/{tableId}/dispatches/{dispatchId}',
  'DELETE /api/v2/tables/{tableId}/dispatches/{dispatchId}',
  'POST /api/v2/tables/{tableId}/exports',
  'GET /api/v2/tables/{tableId}/exports/{exportId}',
  'DELETE /api/v2/tables/{tableId}/exports/{exportId}',
  'GET /api/v2/tables/{tableId}/groups',
  'POST /api/v2/tables/{tableId}/groups',
  'PATCH /api/v2/tables/{tableId}/groups',
  'DELETE /api/v2/tables/{tableId}/groups',
  'POST /api/v2/tables/{tableId}/query/count',
  'POST /api/v2/tables/{tableId}/restore',
  'PATCH /api/v2/tables/{tableId}/rows',
  'DELETE /api/v2/tables/{tableId}/rows',
  'DELETE /api/v2/tables/{tableId}/rows/{rowId}',
  'POST /api/v2/tables/{tableId}/rows/{rowId}/enrichment/{groupId}',
  'POST /api/v2/tables/{tableId}/rows/bulk-update',
  'POST /api/v2/tables/{tableId}/rows/search',
  'GET /api/v2/tables/{tableId}/views',
  'POST /api/v2/tables/{tableId}/views',
  'GET /api/v2/tables/{tableId}/views/{viewId}',
  'PATCH /api/v2/tables/{tableId}/views/{viewId}',
  'DELETE /api/v2/tables/{tableId}/views/{viewId}',
])

/**
 * An export download returns a signed link to the whole table as plaintext CSV, which no
 * provenance can follow once fetched, so the link is never returned to the model.
 */
const TABLE_EXPORT_DOWNLOAD_PATTERN = '/api/v2/tables/{tableId}/exports/{exportId}/download'

/**
 * Row data read through the CLI crosses into the model only with its persisted secret
 * provenance activated in the turn's registry; a row-bearing response that reported no
 * provenance marks the registry incomplete so the result is withheld. So does one whose
 * run state or enrichment detail carries error text: that text is captured from executor
 * output, which can hold resolved secret plaintext, and no provenance is persisted with it.
 */
export function createTableReadTransport(context: {
  endpoint: string
  transport: typeof fetch
  registry?: ResolvedSecretTraceRegistry
}): typeof fetch {
  const base = new URL(context.endpoint)
  const basePath = base.pathname.replace(/\/$/, '')

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const route =
      url.origin === base.origin && url.pathname.startsWith(`${basePath}/api/v2/tables`)
        ? matchV2Route(url.pathname.slice(basePath.length))
        : null
    if (!route || TABLE_ROUTES_WITHOUT_ROW_DATA.has(`${method} ${route.pattern}`)) {
      return context.transport(input, init)
    }
    if (route.pattern === TABLE_EXPORT_DOWNLOAD_PATTERN) {
      return Response.json(
        {
          error: {
            message:
              'Table export download links are not returned to Sim. Download the export from the Tables page.',
          },
        },
        { status: 403 }
      )
    }
    const registry = context.registry
    if (!registry) {
      return Response.json(
        { error: { message: 'Table data cannot be returned to Sim in this context.' } },
        { status: 503 }
      )
    }
    let delivered = false
    let unprovenancedErrorText = false
    let settled = false
    let response: Response
    try {
      response = await observeTableRowDelivery(
        async (provenance, values, extras) => {
          if (settled) return
          delivered = true
          if (extras.unprovenancedErrorText) unprovenancedErrorText = true
          await registry.importCrossingProvenance(provenance, values, { trusted: true })
        },
        () => context.transport(input, init)
      )
    } finally {
      settled = true
    }
    if (response.ok && !delivered) registry.markIncomplete('table-result-provenance-unavailable')
    if (response.ok && unprovenancedErrorText) {
      registry.markIncomplete('table-run-state-provenance-unavailable')
    }
    return response
  }
}
