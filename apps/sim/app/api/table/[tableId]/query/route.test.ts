/**
 * @vitest-environment node
 *
 * v2 query route: PostgREST string parsing, unconditional name→id translation
 * (session auth included — the string grammar is name-keyed for every caller),
 * cursor validation, and the response envelope.
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const { mockCheckAccess, mockQueryRows } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockQueryRows: vi.fn(),
}))

vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'Access denied' }, { status: result.status }),
    tablesV2GateError: () => null,
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

function buildTable(): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: {
      columns: [
        { id: 'col_aaa', name: 'name', type: 'string' },
        { id: 'col_bbb', name: 'wins', type: 'number' },
      ],
    },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  }
}

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
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockQueryRows.mockResolvedValue(EMPTY_RESULT)
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
