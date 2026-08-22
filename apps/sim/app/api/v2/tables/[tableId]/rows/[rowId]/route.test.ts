/**
 * @vitest-environment node
 */

import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockTableRowsValidationError } = vi.hoisted(() => {
  class MockTableRowsValidationError extends Error {}
  return {
    mocks: {
      readRow: vi.fn(),
      updateRow: vi.fn(),
      deleteRow: vi.fn(),
    },
    MockTableRowsValidationError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
vi.mock('@/lib/table/application/rows', () => ({
  TableRowsValidationError: MockTableRowsValidationError,
  readTableRow: { operation: { id: 'tables.rows.read' }, execute: mocks.readRow },
  updateTableRow: { operation: { id: 'tables.rows.update' }, execute: mocks.updateRow },
  deleteTableRow: { operation: { id: 'tables.rows.delete' }, execute: mocks.deleteRow },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import { DELETE, GET, PATCH } from '@/app/api/v2/tables/[tableId]/rows/[rowId]/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const AUTH = {
  principal: PRINCIPAL,
  rolloutUserId: 'owner-1',
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
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.readRow.mockResolvedValue({ table: TABLE, row: ROW })
    mocks.updateRow.mockResolvedValue({ table: TABLE, row: ROW, changed: true })
    mocks.deleteRow.mockResolvedValue({ table: TABLE, deletedRowId: ROW.id })
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
    expect(mocks.readRow).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { tableId: 'table-1', rowId: 'row-1', assertedWorkspaceId: WORKSPACE_ID },
      request: req,
    })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(request('GET'), CONTEXT)

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('updates through the shared use case with the exact patch', async () => {
    const req = request('PATCH', { workspaceId: WORKSPACE_ID, data: { name: 'Ada' } })
    const response = await PATCH(req, CONTEXT)

    expect(response.status).toBe(200)
    expect(mocks.updateRow).toHaveBeenCalledWith({
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
    mocks.updateRow.mockRejectedValueOnce(new TableRowNotFoundError())

    const response = await PATCH(
      request('PATCH', { workspaceId: WORKSPACE_ID, data: { name: 'Ada' } }),
      CONTEXT
    )

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('returns the shared single-resource delete envelope', async () => {
    const req = request('DELETE')
    const response = await DELETE(req, CONTEXT)

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ id: 'row-1', deleted: true })
    expect(mocks.deleteRow).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: PRINCIPAL,
        input: expect.objectContaining({ tableId: 'table-1', rowId: 'row-1' }),
      })
    )
  })

  it('preserves a generic forbidden canonical lookup as forbidden', async () => {
    mocks.readRow.mockRejectedValue(new OrchestrationError('forbidden', 'Forbidden'))

    const response = await GET(request('GET'), CONTEXT)

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
  })
})
