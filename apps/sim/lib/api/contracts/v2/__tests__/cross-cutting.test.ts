/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sortSpecSchema, tableViewConfigSchema } from '@/lib/api/contracts/tables'
import { v2ListAuditLogsContract } from '@/lib/api/contracts/v2/audit-logs'
import { ERROR_RESPONSES } from '@/lib/api/contracts/v2/openapi/shared'
import { v2CreateTableViewContract, v2QueryRowsBodySchema } from '@/lib/api/contracts/v2/tables'
import { v2GetWorkflowRunContract } from '@/lib/api/contracts/v2/workflows'
import { FORBIDDEN_DETAIL_CODE_DESCRIPTIONS, FORBIDDEN_DETAIL_CODES } from '@/lib/core/application'

/**
 * The cross-cutting promises that no single resource family owns, and that
 * therefore have nowhere else to be asserted.
 */
describe('v2 403 cause codes', () => {
  it('publishes every code in the generated OpenAPI 403 description', () => {
    for (const code of FORBIDDEN_DETAIL_CODES) {
      expect(ERROR_RESPONSES.Forbidden.description).toContain(code)
      expect(ERROR_RESPONSES.Forbidden.description).toContain(
        FORBIDDEN_DETAIL_CODE_DESCRIPTIONS[code]
      )
    }
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
