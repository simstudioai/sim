import { tableApiMock, tableApiMockFns } from '@sim/testing/mocks/table-api.mock'
import {
  MockTableV2FeatureDisabledError,
  tableApplicationRowsMock,
  tableApplicationRowsMockFns,
} from '@sim/testing/mocks/table-application-rows.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/api', () => tableApiMock)

vi.mock('@/lib/table/api/row-route-policies', () => ({
  internalTableV2QueryErrorPolicy: {
    project: (error: unknown) =>
      error instanceof MockTableV2FeatureDisabledError
        ? {
            status: 403,
            body: { error: error.message, code: 'tables_v2_disabled' },
          }
        : null,
  },
}))

vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)

import { POST } from '@/app/api/table/[tableId]/query/route'

const mocks = {
  authenticate: tableApiMockFns.mockAuthenticate,
  queryRows: tableApplicationRowsMockFns.mockQueryTableRows,
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
  position: 0,
  orderKey: 'a0',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

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

function callQuery(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost/api/table/table-1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tableId: 'table-1' }) }
  )
}

describe('POST /api/table/[tableId]/query application adapter', () => {
  beforeEach(() => {
    sessionPrincipal()
    mocks.queryRows.mockResolvedValue({
      table: TABLE,
      rows: [ROW],
      rowCount: 1,
      totalCount: 1,
      limit: 10,
      offset: 0,
      nextCursor: null,
    })
  })

  it('uses canonical delegated workspace and returns name-keyed rows', async () => {
    executorPrincipal()
    const response = await callQuery({ workspaceId: 'workspace-forged', limit: 10 })

    expect(mocks.queryRows.mock.calls[0][0].input.assertedWorkspaceId).toBe('workspace-canonical')
    expect((await response.json()).data.rows[0].data).toEqual({ Name: 'Ada', Age: 36 })
  })
})
