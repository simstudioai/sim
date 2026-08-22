/**
 * @vitest-environment node
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { filesAuditOpenApiDocument } from '@/lib/api/contracts/v2/openapi/files-audit'
import { resourcesOpenApiDocument } from '@/lib/api/contracts/v2/openapi/resources'
import { HEAD_MIRRORS_GET, HEAD_OMITS_PAYLOAD_HEADERS } from '@/lib/api/contracts/v2/openapi/shared'
import { tablesOpenApiDocument } from '@/lib/api/contracts/v2/openapi/tables'
import { workflowsOpenApiDocument } from '@/lib/api/contracts/v2/openapi/workflows'
import type { OpenApiDocumentDefinition, OpenApiRouteDefinition } from '@/lib/api/openapi/types'

const APP_ROOT = path.resolve(import.meta.dirname, '../../../../../app')

const DOCUMENTS: readonly OpenApiDocumentDefinition[] = [
  filesAuditOpenApiDocument,
  resourcesOpenApiDocument,
  tablesOpenApiDocument,
  workflowsOpenApiDocument,
]

/**
 * Reads the route module's source rather than importing it: importing an
 * `app/api/**` route pulls the whole server graph into a contract-layer test,
 * and `headSafe` is a literal on the builder call, so the source is where it is
 * unambiguously visible.
 */
function declaresHeadNotSafe(route: OpenApiRouteDefinition): boolean {
  if (route.contract.method !== 'GET') return false
  const file = path.join(APP_ROOT, route.contract.path, 'route.ts')
  if (!existsSync(file)) return false
  return readFileSync(file, 'utf8')
    .split('\n')
    .some((line) => line.trim() === 'headSafe: false,')
}

/**
 * What a `HEAD` answers on a `headSafe: false` route is a security claim, and a
 * published description that drifts from the builder tells callers a probe on a
 * forbidden or nonexistent id is a `200`. That is worth a standing check rather
 * than a one-time correction.
 */
describe('operations whose GET declares headSafe: false', () => {
  it('document that HEAD is authorized exactly as GET is', () => {
    const routes = DOCUMENTS.flatMap((document) => document.routes).filter(declaresHeadNotSafe)

    expect(routes.length).toBeGreaterThan(0)
    expect(
      routes
        .filter((route) => !route.operation.description.includes(HEAD_MIRRORS_GET))
        .map((route) => `${route.operation.operationId} (GET ${route.contract.path})`)
    ).toEqual([])
  })

  /**
   * The `200` documents `Content-Type`, `Content-Length`, and
   * `Content-Disposition`, and the `HEAD` short-circuit answers before the read
   * that produces any of them — so all three are absent on a `HEAD` the spec's
   * own success object appears to promise them for. A caller sizing a download
   * from `Content-Length` gets nothing back and no way to have known that.
   */
  it('says a HEAD omits the payload headers its 200 documents', () => {
    /** Rate-limit headers ARE emitted on a HEAD; only these three are not. */
    const payloadHeaders = ['Content-Type', 'Content-Length', 'Content-Disposition']
    const withPayloadHeaders = DOCUMENTS.flatMap((document) => document.routes)
      .filter(declaresHeadNotSafe)
      .filter((route) =>
        (route.operation.success?.headers ?? []).some((header) => payloadHeaders.includes(header))
      )

    expect(withPayloadHeaders.length).toBeGreaterThan(0)
    expect(
      withPayloadHeaders
        .filter((route) => !route.operation.description.includes(HEAD_OMITS_PAYLOAD_HEADERS))
        .map((route) => `${route.operation.operationId} (GET ${route.contract.path})`)
    ).toEqual([])
  })

  it('never claims a HEAD is answered without an authorization check', () => {
    const claiming = DOCUMENTS.flatMap((document) => document.routes)
      .filter((route) =>
        /`?HEAD`? request is answered with an empty/i.test(route.operation.description)
      )
      .map((route) => route.operation.operationId)

    expect(claiming).toEqual([])
  })
})
