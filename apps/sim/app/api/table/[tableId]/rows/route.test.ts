/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockInsertRow, mockValidateRowData, mockQueryRows } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockInsertRow: vi.fn(),
  mockValidateRowData: vi.fn(),
  mockQueryRows: vi.fn(),
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
    deleteRowsByFilter: vi.fn(),
    deleteRowsByIds: vi.fn(),
    updateRowsByFilter: vi.fn(),
    validateBatchRows: vi.fn(),
    validateRowData: mockValidateRowData,
    validateRowSize: vi.fn(() => ({ valid: true })),
  }
})

vi.mock('@/lib/table/rows/service', () => ({
  queryRows: mockQueryRows,
}))

vi.mock('@/lib/table/sql', () => ({
  TableQueryValidationError: class TableQueryValidationError extends Error {},
}))

import { GET, POST } from '@/app/api/table/[tableId]/rows/route'

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

function callPost(body: Record<string, unknown>) {
  const req = new NextRequest('http://localhost:3000/api/table/tbl_1/rows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId: 'tbl_1' }) })
}

function callGet(query: Record<string, string>) {
  const params = new URLSearchParams(query)
  const req = new NextRequest(`http://localhost:3000/api/table/tbl_1/rows?${params}`, {
    method: 'GET',
  })
  return GET(req, { params: Promise.resolve({ tableId: 'tbl_1' }) })
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
})
