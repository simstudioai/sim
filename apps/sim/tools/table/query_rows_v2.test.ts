/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tableQueryRowsV2Tool } from '@/tools/table/query_rows_v2'

describe('tableQueryRowsV2Tool request body', () => {
  it('normalizes a root condition before sending the request', () => {
    const body = tableQueryRowsV2Tool.request.body!({
      tableId: 'tbl_1',
      filter: { field: 'status', op: 'eq', value: 'active' },
      _context: { workspaceId: 'ws-1' },
    })

    expect(body).toEqual({
      workspaceId: 'ws-1',
      predicate: { all: [{ field: 'status', op: 'eq', value: 'active' }] },
    })
  })

  it('keeps an explicit group unchanged', () => {
    const filter = {
      any: [
        { field: 'status', op: 'eq' as const, value: 'active' },
        { field: 'status', op: 'eq' as const, value: 'pending' },
      ],
    }
    const body = tableQueryRowsV2Tool.request.body!({
      tableId: 'tbl_1',
      filter,
      _context: { workspaceId: 'ws-1' },
    })

    expect((body as { predicate: unknown }).predicate).toBe(filter)
  })

  it('fails fast on a malformed filter before issuing the request', () => {
    expect(() =>
      tableQueryRowsV2Tool.request.body!({
        tableId: 'tbl_1',
        filter: { status: 'active' } as never,
        _context: { workspaceId: 'ws-1' },
      })
    ).toThrow(/group.*condition/i)
  })
})
