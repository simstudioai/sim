/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { billingOpenApiDocument } from '@/lib/api/contracts/v2/openapi/billing'
import { logsOpenApiDocument } from '@/lib/api/contracts/v2/openapi/logs'
import { resourcesOpenApiDocument } from '@/lib/api/contracts/v2/openapi/resources'
import type { OpenApiDocumentDefinition, OpenApiRouteDefinition } from '@/lib/api/openapi/types'

/**
 * Mirrors `shouldReadJsonBody` in `lib/api/server/validation`: a contract's body
 * is read, and therefore size-capped, exactly when it is declared on a non-`GET`
 * method. Restating the predicate rather than importing it keeps this file out
 * of the server graph, which the spec generator must not pull in.
 */
function readsJsonBody(route: OpenApiRouteDefinition): boolean {
  return Boolean(route.contract.body) && route.contract.method !== 'GET'
}

function label(route: OpenApiRouteDefinition): string {
  return `${route.operation.operationId} (${route.contract.method} ${route.contract.path})`
}

const DOCUMENTS: readonly OpenApiDocumentDefinition[] = [
  resourcesOpenApiDocument,
  billingOpenApiDocument,
  logsOpenApiDocument,
]

describe.each(DOCUMENTS.map((document) => [document.output, document] as const))(
  '%s',
  (_output, document) => {
    /**
     * `parseRequest` buffers the JSON body under `DEFAULT_MAX_JSON_BODY_BYTES`
     * before any schema runs, and the v2 builders supply the 413 renderer, so
     * every body-carrying operation can answer 413 whether or not it says so. A
     * status a caller cannot see in the spec is a status they will not handle.
     *
     * The sweep is deliberately one-directional. Several bodyless operations
     * publish 413 for their own ceilings — a folder tree too large to load, a
     * generated artifact too large to render — so the converse is false and
     * asserting it would flag correct documentation.
     */
    it('publishes 413 on every operation whose contract carries a request body', () => {
      const undocumented = document.routes
        .filter(
          (route) => readsJsonBody(route) && !route.operation.errors.includes('PayloadTooLarge')
        )
        .map(label)

      expect(undocumented).toEqual([])
    })
  }
)
