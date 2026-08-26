/**
 * @vitest-environment node
 */

import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockTableRowsValidationError } = vi.hoisted(() => {
  class MockTableRowsValidationError extends Error {}
  return { mocks: { batchUpdate: vi.fn() }, MockTableRowsValidationError }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/rows', () => ({
  TableRowsValidationError: MockTableRowsValidationError,
  batchUpdateTableRows: {
    operation: { id: 'tables.rows.update_many' },
    execute: mocks.batchUpdate,
  },
}))

import { POST } from '@/app/api/v2/tables/[tableId]/rows/bulk-update/route'

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

function call(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/tables/table-1/rows/bulk-update', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return {
    request,
    response: POST(request, { params: Promise.resolve({ tableId: 'table-1' }) }),
  }
}

describe('POST /api/v2/tables/[tableId]/rows/bulk-update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.batchUpdate.mockResolvedValue({
      table: { id: 'table-1' },
      affectedCount: 2,
      affectedRowIds: ['row-1', 'row-2'],
    })
  })

  it('delegates every distinct patch under the strict public write policy', async () => {
    const updates = [
      { rowId: 'row-1', data: { status: 'active' } },
      { rowId: 'row-2', data: { status: 'churned' } },
    ]
    const invocation = call({ workspaceId: WORKSPACE_ID, updates })
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { updatedCount: 2, updatedRowIds: ['row-1', 'row-2'] },
    })
    expect(mocks.batchUpdate).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: WORKSPACE_ID,
        updates,
        strictWrite: true,
        dataKeying: 'names',
      },
      request: invocation.request,
    })
  })

  it('rejects an empty bulk update before delegation', async () => {
    const response = await call({ workspaceId: WORKSPACE_ID, updates: [] }).response

    expect(response.status).toBe(400)
    expect(mocks.batchUpdate).not.toHaveBeenCalled()
  })

  it('rejects a bulk update naming the same row twice', async () => {
    const response = await call({
      workspaceId: WORKSPACE_ID,
      updates: [
        { rowId: 'row-1', data: { status: 'active' } },
        { rowId: 'row-1', data: { status: 'churned' } },
      ],
    }).response

    expect(response.status).toBe(400)
    expect(mocks.batchUpdate).not.toHaveBeenCalled()
  })

  it('answers 400 when the bulk update names a row this table does not have', async () => {
    mocks.batchUpdate.mockRejectedValueOnce(
      new MockTableRowsValidationError('Rows not found: row-9')
    )

    const response = await call({
      workspaceId: WORKSPACE_ID,
      updates: [{ rowId: 'row-9', data: { status: 'active' } }],
    }).response

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('row-9')
  })

  it('rejects an unauthenticated write before parsing', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await call({ workspaceId: WORKSPACE_ID, updates: [] }).response

    expect(response.status).toBe(401)
    expect(mocks.batchUpdate).not.toHaveBeenCalled()
  })
})
