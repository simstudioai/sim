/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createTableColumnBodySchema,
  tableColumnSchema,
  tableEventStreamQuerySchema,
  tableRowsQuerySchema,
  updateTableColumnBodySchema,
} from '@/lib/api/contracts/tables'

describe('reference column metadata', () => {
  const referenceColumn = {
    name: 'account',
    type: 'reference',
    referenceTableId: 'tbl_accounts',
  }

  it('preserves the target table id in every HTTP column schema', () => {
    expect(tableColumnSchema.parse(referenceColumn).referenceTableId).toBe('tbl_accounts')
    expect(
      createTableColumnBodySchema.parse({
        workspaceId: 'ws-1',
        column: referenceColumn,
      }).column.referenceTableId
    ).toBe('tbl_accounts')
    expect(
      updateTableColumnBodySchema.parse({
        workspaceId: 'ws-1',
        columnName: 'account',
        updates: { referenceTableId: 'tbl_other' },
      }).updates.referenceTableId
    ).toBe('tbl_other')
  })

  it('requires a non-empty target for reference columns', () => {
    expect(tableColumnSchema.safeParse({ name: 'account', type: 'reference' }).success).toBe(false)
    expect(tableColumnSchema.safeParse({ ...referenceColumn, referenceTableId: '' }).success).toBe(
      false
    )
  })

  it('rejects reference metadata on another column type', () => {
    expect(tableColumnSchema.safeParse({ ...referenceColumn, type: 'string' }).success).toBe(false)
  })
})

/**
 * `requestJson` parses the query through this schema on the CLIENT before building the URL, so
 * these values arrive as the caller's real types, not as URL strings. A string-only coercion
 * therefore read the grid's `includeTotal: param === 0` boolean as `false`, and page 0 came back
 * with `totalCount: null` on every table.
 *
 * What that broke is the **filtered** total: `rowTotal` was permanently null, so select-all and
 * everything downstream of it (bulk delete, run scope, the selected-count label) silently fell
 * back to the table's UNFILTERED `rowCount`. It also left `hasMoreTableRows` reading a null total
 * as "more may exist" — though that half is now answered by `nextCursor` instead, so this schema
 * is not what removes the wasted page fetch.
 */
describe('tableRowsQuerySchema includeTotal', () => {
  it('accepts a real boolean, which is what the client passes', () => {
    expect(
      tableRowsQuerySchema.parse({ workspaceId: 'ws-1', includeTotal: true }).includeTotal
    ).toBe(true)
    expect(
      tableRowsQuerySchema.parse({ workspaceId: 'ws-1', includeTotal: false }).includeTotal
    ).toBe(false)
  })

  it('still accepts the URL strings a direct API caller sends', () => {
    expect(
      tableRowsQuerySchema.parse({ workspaceId: 'ws-1', includeTotal: 'true' }).includeTotal
    ).toBe(true)
    expect(
      tableRowsQuerySchema.parse({ workspaceId: 'ws-1', includeTotal: 'false' }).includeTotal
    ).toBe(false)
  })

  it('defaults to true when absent or empty, so a bare request still gets its count', () => {
    expect(tableRowsQuerySchema.parse({ workspaceId: 'ws-1' }).includeTotal).toBe(true)
    expect(tableRowsQuerySchema.parse({ workspaceId: 'ws-1', includeTotal: '' }).includeTotal).toBe(
      true
    )
  })
})

describe('tableRowsQuerySchema limit', () => {
  it('leaves an omitted or empty limit unbounded', () => {
    expect(tableRowsQuerySchema.parse({ workspaceId: 'ws-1' }).limit).toBeUndefined()
    expect(tableRowsQuerySchema.parse({ workspaceId: 'ws-1', limit: '' }).limit).toBeUndefined()
  })

  it('still parses and validates an explicit limit', () => {
    expect(tableRowsQuerySchema.parse({ workspaceId: 'ws-1', limit: '25' }).limit).toBe(25)
    expect(tableRowsQuerySchema.parse({ workspaceId: 'ws-1', limit: '1000000' }).limit).toBe(
      1000000
    )
  })
})

describe('tableEventStreamQuerySchema', () => {
  it('parses an explicit cursor', () => {
    expect(tableEventStreamQuerySchema.parse({ from: '7' })).toEqual({ from: 7 })
  })

  it('keeps 0 as an explicit replay-from-start cursor', () => {
    expect(tableEventStreamQuerySchema.parse({ from: '0' })).toEqual({ from: 0 })
  })

  it('yields undefined when absent — the tail-from-latest signal', () => {
    expect(tableEventStreamQuerySchema.parse({})).toEqual({ from: undefined })
  })

  it('yields undefined for invalid values instead of coercing to a full replay', () => {
    expect(tableEventStreamQuerySchema.parse({ from: 'abc' })).toEqual({ from: undefined })
    expect(tableEventStreamQuerySchema.parse({ from: '-4' })).toEqual({ from: undefined })
  })
})
