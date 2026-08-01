/**
 * @vitest-environment node
 */
import { hybridAuthMockFns, permissionsMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'
import { TableQueryValidationError } from '@/lib/table/errors'

const {
  mockCheckAccess,
  mockInsertRow,
  mockValidateRowData,
  mockQueryRows,
  mockUpdateRowsByFilter,
  mockDeleteRowsByFilter,
} = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockInsertRow: vi.fn(),
  mockValidateRowData: vi.fn(),
  mockQueryRows: vi.fn(),
  mockUpdateRowsByFilter: vi.fn(),
  mockDeleteRowsByFilter: vi.fn(),
}))

vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'Access denied' }, { status: result.status }),
  }
})

vi.mock('@/lib/table', async () => {
  // Real column-keys translation functions; the row-wire helper under test
  // imports them from this barrel.
  const columnKeys = await import('@/lib/table/column-keys')
  return {
    ...columnKeys,
    insertRow: mockInsertRow,
    batchInsertRows: vi.fn(),
    batchUpdateRows: vi.fn(),
    deleteRowsByFilter: mockDeleteRowsByFilter,
    deleteRowsByIds: vi.fn(),
    updateRowsByFilter: mockUpdateRowsByFilter,
    validateBatchRows: vi.fn(),
    validateRowData: mockValidateRowData,
    validateRowSize: vi.fn(() => ({ valid: true })),
  }
})

vi.mock('@/lib/table/rows/service', () => ({
  queryRows: mockQueryRows,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/table/sql', () => ({
  TableQueryValidationError: class TableQueryValidationError extends Error {},
}))

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/table/[tableId]/rows/route'

function buildTable(): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: {
      columns: [
        { id: 'col_aaa', name: 'Name', type: 'string' },
        { id: 'col_bbb', name: 'Age', type: 'number' },
      ],
    },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    locks: {
      schemaLocked: false,
      insertLocked: false,
      updateLocked: false,
      deleteLocked: false,
    },
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  }
}

function buildMemoryTable(): TableDefinition {
  return {
    ...buildTable(),
    id: 'system_memory_workspace-1',
    name: 'Memory',
    isVirtual: true,
    schema: {
      columns: [
        { id: 'conversation_id', name: 'Conversation ID', type: 'string' },
        { id: 'transcript', name: 'Transcript', type: 'json' },
        { id: 'message_count', name: 'Message Count', type: 'number' },
        { id: 'created_at', name: 'Created', type: 'date' },
        { id: 'updated_at', name: 'Updated', type: 'date' },
      ],
    },
    locks: {
      schemaLocked: true,
      insertLocked: true,
      updateLocked: true,
      deleteLocked: true,
    },
  }
}

function authAs(authType: 'session' | 'internal_jwt') {
  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType,
  })
}

function callPost(body: Record<string, unknown>, tableId = 'tbl_1') {
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId }) })
}

function callGet(query: Record<string, string>, tableId = 'tbl_1') {
  const params = new URLSearchParams(query)
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/rows?${params}`, {
    method: 'GET',
  })
  return GET(req, { params: Promise.resolve({ tableId }) })
}

describe('POST /api/table/[tableId]/rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockValidateRowData.mockResolvedValue({ valid: true })
    mockInsertRow.mockResolvedValue({
      id: 'row_1',
      data: { col_aaa: 'Ada', col_bbb: 36 },
      position: 1,
      orderKey: 'a0',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })
  })

  it('translates name-keyed data to column ids for internal-JWT (workflow tool) callers', async () => {
    authAs('internal_jwt')

    const res = await callPost({
      workspaceId: 'workspace-1',
      data: { Name: 'Ada', Age: 36 },
    })

    expect(res.status).toBe(200)
    expect(mockValidateRowData).toHaveBeenCalledWith(
      expect.objectContaining({ rowData: { col_aaa: 'Ada', col_bbb: 36 } })
    )
    expect(mockInsertRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: { col_aaa: 'Ada', col_bbb: 36 } }),
      expect.anything(),
      expect.any(String)
    )

    const body = await res.json()
    expect(body.data.row.data).toEqual({ Name: 'Ada', Age: 36 })
  })

  it('passes id-keyed data through untouched for session (UI) callers', async () => {
    authAs('session')

    const res = await callPost({
      workspaceId: 'workspace-1',
      data: { col_aaa: 'Ada', col_bbb: 36 },
    })

    expect(res.status).toBe(200)
    expect(mockInsertRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: { col_aaa: 'Ada', col_bbb: 36 } }),
      expect.anything(),
      expect.any(String)
    )

    const body = await res.json()
    expect(body.data.row.data).toEqual({ col_aaa: 'Ada', col_bbb: 36 })
  })

  it('rejects synthetic Memory row writes with a read-only explanation', async () => {
    authAs('session')
    mockCheckAccess.mockResolvedValue({ ok: false, status: 423 })

    const res = await callPost(
      { workspaceId: 'workspace-1', data: { transcript: [] } },
      'system_memory_workspace-1'
    )

    expect(res.status).toBe(423)
    expect(mockCheckAccess).toHaveBeenCalledWith('system_memory_workspace-1', 'user-1', 'write')
    expect(mockInsertRow).not.toHaveBeenCalled()
  })
})

describe('GET /api/table/[tableId]/rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockQueryRows.mockResolvedValue({
      rows: [
        {
          id: 'row_1',
          data: { col_aaa: 'Ada', col_bbb: 36 },
          position: 1,
          orderKey: 'a0',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ],
      rowCount: 1,
      totalCount: 1,
      limit: 100,
      offset: 0,
    })
  })

  it('returns complete transcript rows to a workspace reader', async () => {
    authAs('session')
    const transcript = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        ...buildTable(),
        id: 'system_memory_workspace-1',
        name: 'Memory',
        locks: {
          schemaLocked: true,
          insertLocked: true,
          updateLocked: true,
          deleteLocked: true,
        },
      },
    })
    mockQueryRows.mockResolvedValue({
      rows: [
        {
          id: 'mem_1',
          data: {
            conversation_id: 'conversation-1',
            transcript,
            message_count: 2,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z',
          },
          executions: {},
          position: 0,
          orderKey: '2026-01-02T00:00:00.000Z',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
      rowCount: 1,
      totalCount: 1,
      limit: 100,
      offset: 0,
      nextCursor: null,
    })

    const res = await callGet(
      { workspaceId: 'workspace-1', limit: '100', includeTotal: 'true' },
      'system_memory_workspace-1'
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.rows[0].data.transcript).toEqual(transcript)
    expect(mockCheckAccess).toHaveBeenCalledWith('system_memory_workspace-1', 'user-1', 'read')
    expect(mockQueryRows).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'system_memory_workspace-1' }),
      expect.objectContaining({ limit: 100, offset: 0, after: undefined, includeTotal: true }),
      expect.any(String)
    )
  })

  it('does not return Memory rows to someone outside the workspace', async () => {
    authAs('session')
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callGet(
      { workspaceId: 'workspace-1', limit: '100' },
      'system_memory_workspace-1'
    )

    expect(res.status).toBe(403)
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it.each([
    [
      'filter',
      { filter: JSON.stringify({ conversation_id: { $eq: 'conversation-1' } }) },
      { filter: { conversation_id: { $eq: 'conversation-1' } } },
    ],
    ['sort', { sort: JSON.stringify({ updated_at: 'desc' }) }, { sort: { updated_at: 'desc' } }],
  ])('passes supported Memory metadata %s to the row service', async (_name, query, expected) => {
    authAs('session')
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildMemoryTable() })

    const res = await callGet({ workspaceId: 'workspace-1', ...query }, 'system_memory_workspace-1')

    expect(res.status).toBe(200)
    expect(mockQueryRows).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'system_memory_workspace-1', isVirtual: true }),
      expect.objectContaining(expected),
      expect.any(String)
    )
  })

  it.each([
    ['filter', { filter: JSON.stringify({ transcript: { $contains: 'hello' } }) }],
    ['sort', { sort: JSON.stringify({ transcript: 'asc' }) }],
  ])('returns the Memory transcript %s validation error', async (_name, query) => {
    authAs('session')
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildMemoryTable() })
    mockQueryRows.mockRejectedValue(
      new TableQueryValidationError(
        'Transcript filtering and sorting are not supported for this table'
      )
    )

    const res = await callGet({ workspaceId: 'workspace-1', ...query }, 'system_memory_workspace-1')

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Transcript filtering and sorting are not supported for this table',
    })
    expect(mockQueryRows).toHaveBeenCalled()
  })

  it('translates name-keyed filter/sort and returns name-keyed rows for internal-JWT callers', async () => {
    authAs('internal_jwt')

    const res = await callGet({
      workspaceId: 'workspace-1',
      filter: JSON.stringify({ Name: { $eq: 'Ada' } }),
      sort: JSON.stringify({ Age: 'desc' }),
    })

    expect(res.status).toBe(200)
    expect(mockQueryRows).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tbl_1' }),
      expect.objectContaining({
        filter: { col_aaa: { $eq: 'Ada' } },
        sort: { col_bbb: 'desc' },
      }),
      expect.any(String)
    )

    const body = await res.json()
    expect(body.data.rows[0].data).toEqual({ Name: 'Ada', Age: 36 })
  })

  it('passes id-keyed filter and rows through untouched for session callers', async () => {
    authAs('session')

    const res = await callGet({
      workspaceId: 'workspace-1',
      filter: JSON.stringify({ col_aaa: { $eq: 'Ada' } }),
    })

    expect(res.status).toBe(200)
    expect(mockQueryRows).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tbl_1' }),
      expect.objectContaining({ filter: { col_aaa: { $eq: 'Ada' } } }),
      expect.any(String)
    )

    const body = await res.json()
    expect(body.data.rows[0].data).toEqual({ col_aaa: 'Ada', col_bbb: 36 })
  })

  /**
   * The grid now speaks the v2 grammar on this route: a predicate-shaped filter
   * takes the NATIVE predicate path into queryRows (not a downgrade), and an
   * ordered sort spec compiles to the record the engine's sort builder takes.
   */
  it('routes a predicate filter + spec sort natively for session callers', async () => {
    authAs('session')

    const res = await callGet({
      workspaceId: 'workspace-1',
      filter: JSON.stringify({ all: [{ field: 'col_aaa', op: 'eq', value: 'Ada' }] }),
      sort: JSON.stringify([{ field: 'col_bbb', direction: 'desc' }]),
    })

    expect(res.status).toBe(200)
    const options = mockQueryRows.mock.calls[0][1]
    expect(options.predicate).toEqual({ all: [{ field: 'col_aaa', op: 'eq', value: 'Ada' }] })
    expect(options.filter).toBeUndefined()
    expect(options.sort).toEqual({ col_bbb: 'desc' })
  })

  it('translates a name-keyed predicate for internal-JWT callers', async () => {
    authAs('internal_jwt')

    const res = await callGet({
      workspaceId: 'workspace-1',
      filter: JSON.stringify({ all: [{ field: 'Name', op: 'eq', value: 'Ada' }] }),
      sort: JSON.stringify([{ field: 'Age', direction: 'asc' }]),
    })

    expect(res.status).toBe(200)
    const options = mockQueryRows.mock.calls[0][1]
    expect(options.predicate).toEqual({ all: [{ field: 'col_aaa', op: 'eq', value: 'Ada' }] })
    expect(options.sort).toEqual({ col_bbb: 'asc' })
  })

  /**
   * Storage validation runs post-translation, mirroring bulk PUT/DELETE: a
   * typo'd field must 400, not compile to a clause that matches nothing and
   * read back as a plausible empty page.
   */
  it('400s a predicate naming an unknown column instead of returning an empty page', async () => {
    authAs('session')

    const res = await callGet({
      workspaceId: 'workspace-1',
      filter: JSON.stringify({ all: [{ field: 'col_nope', op: 'eq', value: 'Ada' }] }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Unknown filter column "col_nope"/)
    expect(mockQueryRows).not.toHaveBeenCalled()
  })
})

describe('PUT/DELETE /api/table/[tableId]/rows — predicate filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockUpdateRowsByFilter.mockResolvedValue({ affectedCount: 1, affectedRowIds: ['row_1'] })
    mockDeleteRowsByFilter.mockResolvedValue({ affectedCount: 1, affectedRowIds: ['row_1'] })
  })

  function callPut(body: Record<string, unknown>, tableId = 'tbl_1') {
    const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/rows`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return PUT(req, { params: Promise.resolve({ tableId }) })
  }

  function callDelete(body: Record<string, unknown>, tableId = 'tbl_1') {
    const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/rows`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return DELETE(req, { params: Promise.resolve({ tableId }) })
  }

  function callPatch(body: Record<string, unknown>, tableId = 'tbl_1') {
    const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/rows`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return PATCH(req, { params: Promise.resolve({ tableId }) })
  }

  it.each([
    [
      'PUT',
      callPut,
      {
        workspaceId: 'workspace-1',
        filter: { conversation_id: { $eq: 'conversation-1' } },
        data: { transcript: [] },
      },
    ],
    ['DELETE', callDelete, { workspaceId: 'workspace-1', rowIds: ['memory-1'] }],
    [
      'PATCH',
      callPatch,
      {
        workspaceId: 'workspace-1',
        updates: [{ rowId: 'memory-1', data: { transcript: [] } }],
      },
    ],
  ])('rejects synthetic Memory %s writes through shared access', async (_method, call, body) => {
    authAs('session')
    mockCheckAccess.mockResolvedValue({ ok: false, status: 423 })

    const res = await call(body, 'system_memory_workspace-1')

    expect(res.status).toBe(423)
    expect(mockCheckAccess).toHaveBeenCalledWith('system_memory_workspace-1', 'user-1', 'write')
    expect(mockUpdateRowsByFilter).not.toHaveBeenCalled()
    expect(mockDeleteRowsByFilter).not.toHaveBeenCalled()
  })

  /**
   * Keying follows the caller (PR #6067 review): the grid authors ID-keyed
   * predicates and the session wire is identity, so ids pass through — and a
   * NAME under session auth is just an unknown storage key, rejected like any
   * other typo rather than half-translated.
   */
  it('PUT passes an id-keyed predicate through untouched under SESSION auth', async () => {
    authAs('session')
    const res = await callPut({
      workspaceId: 'workspace-1',
      filter: { all: [{ field: 'col_aaa', op: 'eq', value: 'Ada' }] },
      data: { col_aaa: 'Grace' },
    })

    expect(res.status).toBe(200)
    const args = mockUpdateRowsByFilter.mock.calls[0][1]
    expect(args.filter).toEqual({ $and: [{ col_aaa: 'Ada' }] })
  })

  it('PUT rejects an unknown storage key under SESSION auth with 400', async () => {
    authAs('session')
    const res = await callPut({
      workspaceId: 'workspace-1',
      filter: { all: [{ field: 'Name', op: 'eq', value: 'Ada' }] },
      data: { col_aaa: 'Grace' },
    })
    expect(res.status).toBe(400)
    expect(mockUpdateRowsByFilter).not.toHaveBeenCalled()
  })

  it('PUT translates a name-keyed predicate for INTERNAL_JWT callers', async () => {
    authAs('internal_jwt')
    const res = await callPut({
      workspaceId: 'workspace-1',
      filter: { all: [{ field: 'Name', op: 'eq', value: 'Ada' }] },
      data: { Name: 'Grace' },
    })

    expect(res.status).toBe(200)
    const args = mockUpdateRowsByFilter.mock.calls[0][1]
    expect(args.filter).toEqual({ $and: [{ col_aaa: 'Ada' }] })
  })

  it('DELETE accepts the predicate and rejects an unknown column with 400', async () => {
    authAs('internal_jwt')
    const ok = await callDelete({
      workspaceId: 'workspace-1',
      filter: { all: [{ field: 'Age', op: 'gte', value: 30 }] },
    })
    expect(ok.status).toBe(200)
    const args = mockDeleteRowsByFilter.mock.calls[0][1]
    expect(args.filter).toEqual({ $and: [{ col_bbb: { $gte: 30 } }] })

    const bad = await callDelete({
      workspaceId: 'workspace-1',
      filter: { all: [{ field: 'Nope', op: 'eq', value: 1 }] },
    })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/Unknown filter column/)
  })
})
