/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sortSpecSchema, tableViewConfigSchema } from '@/lib/api/contracts/tables'
import { rejectsUnknownKeys } from '@/lib/api/contracts/v2/__tests__/schema-introspection'
import { v2ListAuditLogsContract } from '@/lib/api/contracts/v2/audit-logs'
import { filesAuditOpenApiDocument } from '@/lib/api/contracts/v2/openapi/files-audit'
import { knowledgeOpenApiDocument } from '@/lib/api/contracts/v2/openapi/knowledge'
import { ERROR_RESPONSES } from '@/lib/api/contracts/v2/openapi/shared'
import { v2ForbiddenDetailCodeSchema } from '@/lib/api/contracts/v2/shared'
import { v2CreateTableViewContract, v2QueryRowsBodySchema } from '@/lib/api/contracts/v2/tables'
import { v2GetWorkflowRunContract } from '@/lib/api/contracts/v2/workflows'
import { FORBIDDEN_DETAIL_CODES } from '@/lib/core/application/forbidden'

/**
 * The cross-cutting promises that no single resource family owns, and that
 * therefore have nowhere else to be asserted.
 */
describe('v2 403 cause codes', () => {
  it('publishes every actionable code as a structural enum', () => {
    expect(v2ForbiddenDetailCodeSchema.options).toEqual([...FORBIDDEN_DETAIL_CODES])
  })

  it('tells a client the codes live on error.details.code', () => {
    expect(ERROR_RESPONSES.Forbidden.description).toContain('error.details.code')
  })
})

/**
 * Two v2 boolean query params were spelled as a `'true'`/`'false'` string enum
 * while four others were real booleans. Normalising them onto the shared flag
 * must not change what an existing caller can send, so both spellings are
 * pinned rather than just the new one.
 */
describe('v2 boolean query params', () => {
  const cases = [
    ['includeOutput', v2GetWorkflowRunContract.query],
    ['includeDeparted', v2ListAuditLogsContract.query],
  ] as const

  it.each(cases)('%s accepts the string spellings unchanged', (field, schema) => {
    expect(schema).toBeDefined()
    const parseField = (value: string) => {
      const parsed = schema?.safeParse(
        field === 'includeDeparted'
          ? { organizationId: 'org-1', [field]: value }
          : { [field]: value }
      )
      expect(parsed?.success).toBe(true)
      return (parsed?.data as Record<string, unknown> | undefined)?.[field]
    }
    expect(parseField('true')).toBe(true)
    expect(parseField('false')).toBe(false)
  })

  it.each(cases)('%s accepts a real boolean and defaults to false', (field, schema) => {
    const withBoolean = schema?.safeParse(
      field === 'includeDeparted' ? { organizationId: 'org-1', [field]: true } : { [field]: true }
    )
    expect((withBoolean?.data as Record<string, unknown> | undefined)?.[field]).toBe(true)

    const omitted = schema?.safeParse(
      field === 'includeDeparted' ? { organizationId: 'org-1' } : {}
    )
    expect((omitted?.data as Record<string, unknown> | undefined)?.[field]).toBe(false)
  })

  it.each(cases)('%s still rejects a non-boolean word', (field, schema) => {
    const parsed = schema?.safeParse(
      field === 'includeDeparted' ? { organizationId: 'org-1', [field]: 'yes' } : { [field]: 'yes' }
    )
    expect(parsed?.success).toBe(false)
  })
})

/**
 * `.strict()` binds the top level only. These are the two places on the tables
 * surface where that mattered: an unknown key one level down was accepted and
 * dropped, so the caller got a 200 for a request the server did not honour —
 * the same failure class as the v1-shaped `filter` key returning an unfiltered
 * page.
 */
describe('tables nested strictness', () => {
  it('rejects an unsupported per-sort option instead of dropping it', () => {
    const parsed = sortSpecSchema.safeParse([{ field: 'name', direction: 'asc', nulls: 'last' }])
    expect(parsed.success).toBe(false)
  })

  it('rejects it on the row query body too', () => {
    const parsed = v2QueryRowsBodySchema.safeParse({
      workspaceId: 'ws-1',
      sort: [{ field: 'name', direction: 'asc', nulls: 'last' }],
    })
    expect(parsed.success).toBe(false)
  })

  it('still accepts a well-formed sort spec', () => {
    expect(sortSpecSchema.safeParse([{ field: 'name', direction: 'asc' }]).success).toBe(true)
  })

  it('rejects an unknown key inside a saved-view config', () => {
    const parsed = tableViewConfigSchema.safeParse({
      columnOrder: ['col-1'],
      groupBy: 'col-1',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects it through the v2 create-view body', () => {
    const parsed = v2CreateTableViewContract.body?.safeParse({
      workspaceId: 'ws-1',
      name: 'My view',
      config: { columnOrder: ['col-1'], groupBy: 'col-1' },
    })
    expect(parsed?.success).toBe(false)
  })

  it('still accepts a well-formed saved-view config', () => {
    expect(
      tableViewConfigSchema.safeParse({
        columnOrder: ['col-1'],
        hiddenColumns: [],
        sort: [{ field: 'name', direction: 'desc' }],
        filter: null,
      }).success
    ).toBe(true)
  })
})

/**
 * Every caller-authored knowledge and files/audit request slice must reject the
 * keys it does not declare.
 *
 * These two families held the last non-strict *body* slices in v2: four single-field
 * `{ workspaceId }` query objects reused across 15 operations, and the knowledge
 * search body. Zod strips what it does not declare, so a caller that mis-spelt a
 * parameter got a 200 for a request the server never honoured — and on
 * `POST /knowledge/search` the stripped keys were the ones that decide how many
 * search units the call is billed. The strictness was already there on
 * `GET /knowledge/{knowledgeBaseId}/tags`, which is what made the divergence visible:
 * `?foo=1` was a 400 on that one route and a 200 on its siblings.
 *
 * Only `query` and `body` are swept. `params` are produced by the router from
 * the path pattern and `headers` are projected from the schema's own keys, so
 * neither carries a key the caller chose and neither can strip one.
 *
 * The `query` half is now also covered surface-wide by the query-declaration
 * sweep, which walks the contracts tree rather than these two OpenAPI documents.
 * This one stays because it is the only sweep over `body`, and because it is
 * scoped to the families whose strictness regressed.
 */
describe('knowledge and files request-slice strictness', () => {
  const documents = [
    ['knowledge', knowledgeOpenApiDocument],
    ['files & audit', filesAuditOpenApiDocument],
  ] as const

  const slices = documents.flatMap(([family, document]) =>
    document.routes.flatMap((route) =>
      (['query', 'body'] as const)
        .filter((slice) => route.contract[slice] !== undefined)
        .map(
          (slice) =>
            [
              `${family} ${route.operation.operationId} ${slice}`,
              route.contract[slice] as unknown,
            ] as const
        )
    )
  )

  /**
   * A count, so a document that stopped listing its routes cannot make every
   * assertion below pass vacuously. It rises when a route gains a slice: it went
   * 45 → 63 when the knowledge and files endpoints that take no query params
   * started saying so with `noInputSchema` instead of omitting `query`, and
   * 63 → 87 with the knowledge chunk, tag-write, archive, restore, and
   * workspace-file-ingest operations, and 87 → 95 with the file upload-session
   * read, archive extraction, file-text read, folder restore, bulk zip
   * download, and permanent delete. It falls when two routes become one: 106 →
   * 105 when the archived knowledge-base list folded into `GET /knowledge` as
   * `scope=archived`, 105 → 108 with the file content-search query and the
   * in-place content edit's query and body, and 108 → 109 with the knowledge
   * base export query.
   */
  it('sweeps every documented query and body slice', () => {
    expect(slices.length).toBe(109)
  })

  it.each(slices)('%s rejects an undeclared key', (_name, schema) => {
    expect(rejectsUnknownKeys(schema)).toBe(true)
  })
})

/**
 * `GET /api/v2/audit-logs` was the only v2 query param declaring a workspace
 * identifier as a bare string, so `?workspaceId=` parsed and reached
 * `buildFilterConditions` as a real filter — an empty page rather than the 400
 * an empty required identifier gets on every other v2 read.
 */
describe('v2 audit-log filter bounds', () => {
  const query = v2ListAuditLogsContract.query

  it('rejects an empty workspaceId instead of filtering on it', () => {
    const parsed = query?.safeParse({ organizationId: 'org-1', workspaceId: '' })
    expect(parsed?.success).toBe(false)
  })

  it('still accepts an omitted workspaceId', () => {
    expect(query?.safeParse({ organizationId: 'org-1' }).success).toBe(true)
  })

  it.each(['startDate', 'endDate'])(
    '%s takes the shared UTC run-window form rather than a loose Date.parse',
    (field) => {
      const dateOnly = query?.safeParse({ organizationId: 'org-1', [field]: '2026-08-06' })
      const offsetBearing = query?.safeParse({
        organizationId: 'org-1',
        [field]: '2026-08-06T00:00:00+02:00',
      })
      const utc = query?.safeParse({ organizationId: 'org-1', [field]: '2026-08-06T00:00:00Z' })

      expect(dateOnly?.success).toBe(false)
      expect(offsetBearing?.success).toBe(false)
      expect(utc?.success).toBe(true)
    }
  )
})
