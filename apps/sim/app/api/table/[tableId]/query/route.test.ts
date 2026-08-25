/**
 * @vitest-environment node
 *
 * v2 query route: predicate parsing, unconditional name→id translation
 * (session auth included — the string grammar is name-keyed for every caller),
 * cursor validation, and the response envelope.
 */
import { createTableDefinition, hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckAccess, mockQueryRows, mockGate } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockQueryRows: vi.fn(),
  mockGate: vi.fn(),
}))

vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'Access denied' }, { status: result.status }),
    tablesV2GateError: mockGate,
  }
})

vi.mock('@/lib/table', async () => {
  // row-wire pulls the column-keys helpers through this barrel.
  const columnKeys = await import('@/lib/table/column-keys')
  return { ...columnKeys }
})

vi.mock('@/lib/table/rows/service', () => ({
  queryRows: mockQueryRows,
}))

import { encodeCursor } from '@/lib/table/rows/cursor'
import { POST } from '@/app/api/table/[tableId]/query/route'

function authAs(authType: 'session' | 'internal_jwt') {
  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType,
  })
}

function callQuery(body: Record<string, unknown>) {
  const req = new NextRequest('http://localhost:3000/api/table/tbl_1/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId: 'tbl_1' }) })
}

const EMPTY_RESULT = {
  rows: [],
  rowCount: 0,
  totalCount: 0,
  limit: 0,
  offset: 0,
  nextCursor: null,
}

describe('POST /api/table/[tableId]/query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: createTableDefinition({
        columns: [
          { id: 'col_aaa', name: 'name', type: 'string' },
          { id: 'col_bbb', name: 'wins', type: 'number' },
        ],
        maxRows: 100,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }),
    })
    mockQueryRows.mockResolvedValue(EMPTY_RESULT)
    mockGate.mockResolvedValue(null)
  })

  it('returns 404 when the tables-v2-api flag is off', async () => {
    const { NextResponse } = await import('next/server')
    authAs('session')
    mockGate.mockResolvedValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    const res = await callQuery({ workspaceId: 'workspace-1' })
    expect(res.status).toBe(404)
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('runs the flag gate only after the access check, so it cannot leak a cohort oracle', async () => {
    authAs('session')
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })
    const res = await callQuery({ workspaceId: 'workspace-1' })
    expect(res.status).toBe(403)
    expect(mockGate).not.toHaveBeenCalled()
  })

  it('translates predicate/sort column names to storage ids for SESSION auth too', async () => {
    authAs('session')
    const res = await callQuery({
      workspaceId: 'workspace-1',
      predicate: {
        all: [
          { field: 'name', op: 'eq', value: 'John' },
          { field: 'wins', op: 'gte', value: 10 },
        ],
      },
      sort: [{ field: 'wins', direction: 'desc' }],
    })

    expect(res.status).toBe(200)
    const options = mockQueryRows.mock.calls[0][1]
    expect(options.predicate).toEqual({
      all: [
        { field: 'col_aaa', op: 'eq', value: 'John' },
        { field: 'col_bbb', op: 'gte', value: 10 },
      ],
    })
    expect(options.sort).toEqual({ col_bbb: 'desc' })
    expect(options.withExecutions).toBe(false)
  })

  it('selects a stable column id and returns its current name to a workflow', async () => {
    authAs('internal_jwt')
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: createTableDefinition({
        columns: [
          { id: 'col_aaa', name: 'renamed_name', type: 'string' },
          { id: 'col_bbb', name: 'wins', type: 'number' },
        ],
        maxRows: 100,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }),
    })
    mockQueryRows.mockResolvedValue({
      ...EMPTY_RESULT,
      rows: [
        {
          id: 'row_1',
          data: { col_aaa: 'Ana' },
          executions: {},
          position: 1,
          orderKey: 'a0',
          createdAt: new Date('2026-08-20T10:00:00.000Z'),
          updatedAt: new Date('2026-08-20T10:00:00.000Z'),
        },
      ],
      rowCount: 1,
      totalCount: 1,
      limit: 100,
    })

    const res = await callQuery({ workspaceId: 'workspace-1', columns: ['col_aaa'] })

    expect(res.status).toBe(200)
    // The service projects (so the byte budget measures the response); the route only resolves ids.
    expect(mockQueryRows.mock.calls[0][1].columnIds).toEqual(new Set(['col_aaa']))
    expect((await res.json()).data.rows[0].data).toEqual({ renamed_name: 'Ana' })
  })

  it('accepts an exact column name for direct callers', async () => {
    authAs('internal_jwt')
    mockQueryRows.mockResolvedValue({
      ...EMPTY_RESULT,
      rows: [
        {
          id: 'row_1',
          data: { col_bbb: 12 },
          executions: {},
          position: 1,
          orderKey: 'a0',
          createdAt: new Date('2026-08-20T10:00:00.000Z'),
          updatedAt: new Date('2026-08-20T10:00:00.000Z'),
        },
      ],
      rowCount: 1,
      totalCount: 1,
      limit: 100,
    })

    const res = await callQuery({ workspaceId: 'workspace-1', columns: ['wins'] })

    expect(res.status).toBe(200)
    expect(mockQueryRows.mock.calls[0][1].columnIds).toEqual(new Set(['col_bbb']))
    expect((await res.json()).data.rows[0].data).toEqual({ wins: 12 })
  })

  it('asks for every column when the selection is omitted or empty', async () => {
    authAs('internal_jwt')

    const omitted = await callQuery({ workspaceId: 'workspace-1' })
    const empty = await callQuery({ workspaceId: 'workspace-1', columns: [] })

    expect(omitted.status).toBe(200)
    expect(empty.status).toBe(200)
    expect(mockQueryRows.mock.calls[0][1].columnIds).toBeUndefined()
    expect(mockQueryRows.mock.calls[1][1].columnIds).toBeUndefined()
  })

  it('drops a column reference that no longer exists without exposing diagnostics', async () => {
    authAs('internal_jwt')
    const staleId = `col_${'0'.repeat(32)}`

    const res = await callQuery({
      workspaceId: 'workspace-1',
      columns: ['col_aaa', 'missing', staleId],
    })

    expect(res.status).toBe(200)
    expect(mockQueryRows.mock.calls[0][1].columnIds).toEqual(new Set(['col_aaa']))
    expect((await res.json()).data).not.toHaveProperty('ignoredColumns')
  })

  it('returns empty row data, not every column, when no requested column exists', async () => {
    authAs('internal_jwt')

    const res = await callQuery({ workspaceId: 'workspace-1', columns: ['missing'] })

    expect(res.status).toBe(200)
    expect(mockQueryRows.mock.calls[0][1].columnIds).toEqual(new Set())
    expect((await res.json()).data).not.toHaveProperty('ignoredColumns')
  })

  it('does not expose ignored-column diagnostics for valid or omitted selections', async () => {
    authAs('internal_jwt')

    const selected = await callQuery({ workspaceId: 'workspace-1', columns: ['col_aaa'] })
    const all = await callQuery({ workspaceId: 'workspace-1' })

    expect((await selected.json()).data).not.toHaveProperty('ignoredColumns')
    expect((await all.json()).data).not.toHaveProperty('ignoredColumns')
  })

  it('accepts a root condition and executes its canonical all group', async () => {
    authAs('internal_jwt')
    const res = await callQuery({
      workspaceId: 'workspace-1',
      predicate: { field: 'name', op: 'eq', value: 'John' },
    })

    expect(res.status).toBe(200)
    expect(mockQueryRows.mock.calls[0][1].predicate).toEqual({
      all: [{ field: 'col_aaa', op: 'eq', value: 'John' }],
    })
  })

  it('rejects a keyset cursor combined with a custom sort', async () => {
    authAs('internal_jwt')
    const cursor = encodeCursor({
      lastRow: { id: 'row_1', orderKey: 'a1' },
      keysetValid: true,
      nextOffset: 1,
    })
    const res = await callQuery({
      workspaceId: 'workspace-1',
      sort: [{ field: 'wins', direction: 'desc' }],
      cursor,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not valid for a sorted query/)
    expect(body.code).toBe('CURSOR_SORT_CONFLICT')
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('returns 400 (not 500) for a cursor that decodes to a JSON primitive', async () => {
    authAs('internal_jwt')
    const res = await callQuery({
      workspaceId: 'workspace-1',
      cursor: Buffer.from('42').toString('base64url'),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid cursor')
    expect(body.code).toBe('INVALID_CURSOR')
  })

  it('returns 400 for a predicate referencing an unknown column', async () => {
    authAs('internal_jwt')
    const res = await callQuery({
      workspaceId: 'workspace-1',
      predicate: { all: [{ field: 'nope', op: 'eq', value: 1 }] },
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Unknown filter column/)
  })

  it('passes nextCursor through the response envelope and skips the count on later pages', async () => {
    authAs('internal_jwt')
    mockQueryRows.mockResolvedValue({ ...EMPTY_RESULT, nextCursor: 'tok' })
    const cursor = encodeCursor({
      lastRow: { id: 'row_1', orderKey: 'a1' },
      keysetValid: true,
      nextOffset: 1,
    })

    const res = await callQuery({ workspaceId: 'workspace-1', cursor })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.nextCursor).toBe('tok')
    const options = mockQueryRows.mock.calls[0][1]
    expect(options.includeTotal).toBe(false)
    expect(options.after).toEqual({ orderKey: 'a1', id: 'row_1' })
  })
})
