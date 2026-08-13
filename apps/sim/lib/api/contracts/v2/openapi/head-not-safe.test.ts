/**
 * @vitest-environment node
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { filesAuditOpenApiDocument } from '@/lib/api/contracts/v2/openapi/files-audit'
import { resourcesOpenApiDocument } from '@/lib/api/contracts/v2/openapi/resources'
import { HEAD_MIRRORS_GET } from '@/lib/api/contracts/v2/openapi/shared'
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
 * The `headSafe: false` short-circuit used to answer a bodiless `200` straight
 * after admission, before the use case — and therefore before authorization —
 * ran at all. Both descriptions that mentioned `HEAD` documented that behavior,
 * and both stayed put when the builders were fixed to authorize first, so the
 * spec went on telling callers a `HEAD` on a forbidden or nonexistent id was a
 * `200`. That is a security claim, which makes it the one sentence worth a
 * standing check rather than a one-time correction.
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

  it('never claims a HEAD is answered without an authorization check', () => {
    const claiming = DOCUMENTS.flatMap((document) => document.routes)
      .filter((route) =>
        /`?HEAD`? request is answered with an empty/i.test(route.operation.description)
      )
      .map((route) => route.operation.operationId)

    expect(claiming).toEqual([])
  })
})
