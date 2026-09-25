import { tableApiMock, tableApiMockFns } from '@sim/testing/mocks/table-api.mock'
import {
  tableApplicationRowsMock,
  tableApplicationRowsMockFns,
} from '@sim/testing/mocks/table-application-rows.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/api', () => tableApiMock)

vi.mock('@/lib/table/api/row-route-policies', () => ({
  internalTableRowsErrorPolicy: { project: () => null },
}))

vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)

import { POST } from '@/app/api/table/[tableId]/rows/route'

const mocks = {
  authenticate: tableApiMockFns.mockAuthenticate,
  createRows: tableApplicationRowsMockFns.mockCreateTableRows,
  queryRows: tableApplicationRowsMockFns.mockQueryTableRows,
  updateRows: tableApplicationRowsMockFns.mockUpdateTableRows,
  batchUpdateRows: tableApplicationRowsMockFns.mockBatchUpdateTableRows,
  deleteRows: tableApplicationRowsMockFns.mockDeleteTableRows,
}

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
})
