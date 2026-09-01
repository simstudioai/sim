/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tableQueryRowsV2Tool } from '@/tools/table/query_rows_v2'

describe('tableQueryRowsV2Tool operation input', () => {
  it('normalizes a root condition before execution', () => {
    const input = tableQueryRowsV2Tool.operation.input({
      tableId: 'tbl_1',
      filter: { field: 'status', op: 'eq', value: 'active' },
      columns: ['col_status'],
      _context: { workspaceId: 'ws-1' },
    })

    expect(input).toEqual({
      tableId: 'tbl_1',
      workspaceId: 'ws-1',
      predicate: { all: [{ field: 'status', op: 'eq', value: 'active' }] },
      columns: ['col_status'],
    })
  })

  it('keeps an explicit group unchanged', () => {
    const filter = {
      any: [
        { field: 'status', op: 'eq' as const, value: 'active' },
        { field: 'status', op: 'eq' as const, value: 'pending' },
      ],
    }
    const input = tableQueryRowsV2Tool.operation.input({
      tableId: 'tbl_1',
      filter,
      _context: { workspaceId: 'ws-1' },
    })

    expect((input as { predicate: unknown }).predicate).toBe(filter)
  })

  it('fails fast on a malformed filter before issuing the request', () => {
    expect(() =>
      tableQueryRowsV2Tool.operation.input({
        tableId: 'tbl_1',
        filter: { status: 'active' } as never,
        _context: { workspaceId: 'ws-1' },
      })
    ).toThrow(/group.*condition/i)
  })

  it.each([undefined, []])('omits columns when the selection is %j', (columns) => {
    const input = tableQueryRowsV2Tool.operation.input({
      tableId: 'tbl_1',
      columns,
      _context: { workspaceId: 'ws-1' },
    })

    expect(input).toEqual({ tableId: 'tbl_1', workspaceId: 'ws-1' })
  })
})

describe('tableQueryRowsV2Tool response', () => {
  const responseBody = {
    success: true,
    data: {
      rows: [
        {
          id: 'row_1',
          data: {
            name: 'Ana',
            email: 'ana@example.com',
            private_notes: 'Call next week',
          },
          executions: {},
          position: 1,
          orderKey: 'a0',
          createdAt: '2026-08-20T10:00:00.000Z',
          updatedAt: '2026-08-20T10:00:00.000Z',
        },
      ],
      rowCount: 1,
      totalCount: 1,
      limit: 100,
      nextCursor: null,
      ignoredColumns: ['private_notez'],
    },
  }

  it('returns projected rows without exposing skipped-column diagnostics', async () => {
    const result = await tableQueryRowsV2Tool.transformResponse!(
      new Response(JSON.stringify(responseBody))
    )

    expect(result.output).toEqual({
      rows: responseBody.data.rows,
      rowCount: responseBody.data.rowCount,
      totalCount: responseBody.data.totalCount,
      limit: responseBody.data.limit,
      nextCursor: responseBody.data.nextCursor,
    })
  })
})
