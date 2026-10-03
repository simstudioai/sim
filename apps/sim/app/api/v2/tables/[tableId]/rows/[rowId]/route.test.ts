import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import {
  tableApplicationRowsMock,
  tableApplicationRowsMockFns,
} from '@sim/testing/mocks/table-application-rows.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)

import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import { GET, PATCH } from '@/app/api/v2/tables/[tableId]/rows/[rowId]/route'

const { mockReadTableRow, mockUpdateTableRow, mockDeleteTableRow } = tableApplicationRowsMockFns

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const TABLE = {
  id: 'table-1',
  workspaceId: WORKSPACE_ID,
  schema: { columns: [{ id: 'column-name', name: 'name', type: 'string' as const }] },
}
const ROW = {
  id: 'row-1',
  data: { 'column-name': 'Ada' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const CONTEXT = { params: Promise.resolve({ tableId: 'table-1', rowId: 'row-1' }) }

function request(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown) {
  return new NextRequest(
    `http://localhost/api/v2/tables/table-1/rows/row-1${method === 'PATCH' ? '' : `?workspaceId=${WORKSPACE_ID}`}`,
    {
      method,
      headers: {
        'x-api-key': 'secret',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  )
}

describe('/api/v2/tables/[tableId]/rows/[rowId]', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mockReadTableRow.mockResolvedValue({ table: TABLE, row: ROW })
    mockUpdateTableRow.mockResolvedValue({ table: TABLE, row: ROW, changed: true })
    mockDeleteTableRow.mockResolvedValue({ table: TABLE, deletedRowId: ROW.id })
  })

  it('reads through the shared use case and strips storage internals', async () => {
    const req = request('GET')
    const response = await GET(req, CONTEXT)

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({
      id: 'row-1',
      data: { name: 'Ada' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(mockReadTableRow).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        rowId: 'row-1',
        assertedWorkspaceId: WORKSPACE_ID,
        includeRunState: false,
      },
      request: req,
    })
  })

  it('updates through the shared use case with the exact patch', async () => {
    const req = request('PATCH', { workspaceId: WORKSPACE_ID, data: { name: 'Ada' } })
    const response = await PATCH(req, CONTEXT)

    expect(response.status).toBe(200)
    expect(mockUpdateTableRow).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        rowId: 'row-1',
        assertedWorkspaceId: WORKSPACE_ID,
        data: { name: 'Ada' },
        strictWrite: true,
        dataKeying: 'names',
      },
      request: req,
    })
  })

  it('returns not found when the row disappears before update', async () => {
    mockUpdateTableRow.mockRejectedValueOnce(new TableRowNotFoundError())

    const response = await PATCH(
      request('PATCH', { workspaceId: WORKSPACE_ID, data: { name: 'Ada' } }),
      CONTEXT
    )

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})
