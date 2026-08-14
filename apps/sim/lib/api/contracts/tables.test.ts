/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tableEventStreamQuerySchema, tableRowsQuerySchema } from '@/lib/api/contracts/tables'

/**
 * `requestJson` parses the query through this schema on the CLIENT before building the URL, so
 * these values arrive as the caller's real types, not as URL strings. A string-only coercion
 * therefore read the grid's `includeTotal: param === 0` boolean as `false`, page 0 came back with
 * `totalCount: null`, and `hasMoreTableRows` — which treats a null total as "more may exist" —
 * reported `hasNextPage` forever. Every table then paid a wasted extra page fetch on mount and
 * before every row insert.
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
