/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createRows: vi.fn(),
  queryRows: vi.fn(),
  updateRows: vi.fn(),
  batchUpdateRows: vi.fn(),
  deleteRows: vi.fn(),
}))

vi.mock('@/lib/table/api', () => ({
  internalTableSessionOrExecutorAuth: { authenticate: mocks.authenticate },
}))

vi.mock('@/lib/table/api/row-route-policies', () => ({
  internalTableRowsErrorPolicy: { project: () => null },
}))

vi.mock('@/lib/table/application/rows', () => ({
  createTableRows: { operation: { id: 'tables.rows.create' }, execute: mocks.createRows },
  queryTableRows: { operation: { id: 'tables.rows.query' }, execute: mocks.queryRows },
  updateTableRows: { operation: { id: 'tables.rows.update_many' }, execute: mocks.updateRows },
  batchUpdateTableRows: {
    operation: { id: 'tables.rows.update_many' },
    execute: mocks.batchUpdateRows,
  },
  deleteTableRows: { operation: { id: 'tables.rows.delete_many' }, execute: mocks.deleteRows },
}))

import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/table/[tableId]/rows/route'

const TABLE = {
  id: 'table-1',
  workspaceId: 'workspace-1',
  schema: {
    columns: [
      { id: 'column-name', name: 'Name', type: 'string' as const },
      { id: 'column-age', name: 'Age', type: 'number' as const },
    ],
  },
}

const ROW = {
  id: 'row-1',
  data: { 'column-name': 'Ada', 'column-age': 36 },
  executions: {},
  position: 0,
  orderKey: 'a0',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const routeContext = { params: Promise.resolve({ tableId: 'table-1' }) }

function sessionPrincipal() {
  mocks.authenticate.mockResolvedValue({
    kind: 'session',
    userId: 'user-1',
    sessionId: 'session-1',
  })
}

function executorPrincipal() {
  mocks.authenticate.mockResolvedValue({
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-canonical',
    delegationId: 'delegation-1',
    audience: 'sim:tables',
    issuedAt: new Date('2026-01-01'),
    expiresAt: new Date('2026-01-02'),
  })
}

function request(method: string, body?: unknown, query = '') {
  return new NextRequest(`http://localhost/api/table/table-1/rows${query}`, {
    method,
    ...(body
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
}

describe('/api/table/[tableId]/rows application adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionPrincipal()
    mocks.createRows.mockResolvedValue({ kind: 'single', table: TABLE, row: ROW })
    mocks.queryRows.mockResolvedValue({
      table: TABLE,
      rows: [ROW],
      rowCount: 1,
      totalCount: 1,
      limit: 10,
      offset: 0,
      nextCursor: null,
    })
    mocks.updateRows.mockResolvedValue({
      table: TABLE,
      affectedCount: 1,
      affectedRowIds: ['row-1'],
    })
    mocks.batchUpdateRows.mockResolvedValue({
      table: TABLE,
      affectedCount: 1,
      affectedRowIds: ['row-1'],
    })
    mocks.deleteRows.mockResolvedValue({
      kind: 'filter',
      table: TABLE,
      affectedCount: 1,
      affectedRowIds: ['row-1'],
    })
  })

  it('maps session inserts as id-keyed writes and preserves the row response', async () => {
    const response = await POST(
      request('POST', {
        workspaceId: 'workspace-1',
        data: { 'column-name': 'Ada' },
      }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(mocks.createRows.mock.calls[0][0].input).toMatchObject({
      assertedWorkspaceId: 'workspace-1',
      dataKeying: 'ids',
      secretProvenanceEnvelope: { kind: 'none' },
    })
    expect((await response.json()).data.row.data).toEqual({
      'column-name': 'Ada',
      'column-age': 36,
    })
  })

  it('maps executor inserts as name-keyed and uses canonical delegated workspace', async () => {
    executorPrincipal()
    await POST(
      request('POST', {
        workspaceId: 'workspace-forged',
        data: { Name: 'Ada' },
      }),
      routeContext
    )

    expect(mocks.createRows.mock.calls[0][0].input).toMatchObject({
      assertedWorkspaceId: 'workspace-canonical',
      dataKeying: 'names',
    })
  })

  it('preserves legacy query filters, sorts, counts, and expanded-limit policy', async () => {
    const filter = encodeURIComponent(JSON.stringify({ 'column-name': { $eq: 'Ada' } }))
    const sort = encodeURIComponent(JSON.stringify({ 'column-age': 'desc' }))
    const response = await GET(
      request(
        'GET',
        undefined,
        `?workspaceId=workspace-1&filter=${filter}&sort=${sort}&limit=10&offset=2`
      ),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(mocks.queryRows.mock.calls[0][0].input).toMatchObject({
      legacyFilter: { 'column-name': { $eq: 'Ada' } },
      legacySort: { 'column-age': 'desc' },
      legacyKeying: 'ids',
      includeTotal: true,
      allowExpandedLimit: true,
      offset: 2,
    })
  })

  it('hands unresolved provenance and caller keying to filter updates', async () => {
    const response = await PUT(
      request('PUT', {
        workspaceId: 'workspace-1',
        filter: { all: [{ field: 'column-name', op: 'eq', value: 'Ada' }] },
        data: { 'column-name': 'Grace' },
      }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(mocks.updateRows.mock.calls[0][0].input).toMatchObject({
      filterKeying: 'ids',
      dataKeying: 'ids',
      secretProvenanceEnvelope: { kind: 'none' },
    })
  })

  it('routes filter deletes through the shared authorized use case', async () => {
    const response = await DELETE(
      request('DELETE', {
        workspaceId: 'workspace-1',
        filter: { all: [{ field: 'column-name', op: 'eq', value: 'Ada' }] },
      }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(mocks.deleteRows.mock.calls[0][0].input).toMatchObject({
      kind: 'filter',
      filterKeying: 'ids',
    })
  })

  it('routes heterogeneous batch patches through one authorized application operation', async () => {
    executorPrincipal()
    const response = await PATCH(
      request('PATCH', {
        workspaceId: 'workspace-forged',
        updates: [{ rowId: 'row-1', data: { Name: 'Grace' } }],
      }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(mocks.batchUpdateRows.mock.calls[0][0].input).toMatchObject({
      tableId: 'table-1',
      assertedWorkspaceId: 'workspace-canonical',
      dataKeying: 'names',
      strictWrite: false,
      updates: [{ rowId: 'row-1', data: { Name: 'Grace' } }],
      secretProvenanceEnvelope: { kind: 'none' },
    })
  })
})
