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

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/tables/presenters', () => ({
  presentV2TableImport: (tableImport: unknown) => ({ data: tableImport }),
}))
vi.mock('@/lib/table/application/imports', () => ({
  completeTableImportUseCase: {
    operation: { id: 'tables.imports.complete' },
    execute: mocks.complete,
  },
}))

import { POST } from '@/app/api/v2/tables/imports/[importId]/complete/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const principal = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const auth = {
  principal,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

describe('POST /api/v2/tables/imports/[importId]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  })

  it('delegates idempotent completion to the authorized import use case', async () => {
    const timestamp = '2026-01-01T00:00:00.000Z'
    const tableImport = {
      id: 'import-1',
      workspaceId: WORKSPACE_ID,
      status: 'completed',
      source: { type: 'upload', name: 'data.csv', contentType: 'text/csv', size: 128 },
      target: { type: 'new', name: 'imported_data' },
      tableId: 'table-1',
      rowsProcessed: 2,
      rowsRejected: 0,
      cellsRejected: 0,
      rejectedSamples: [],
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: timestamp,
    }
    mocks.complete.mockResolvedValue({ import: tableImport })
    const request = new NextRequest(
      `http://localhost:3000/api/v2/tables/imports/import-1/complete?workspaceId=${WORKSPACE_ID}`,
      { method: 'POST', headers: { 'upload-token': 'signed-upload-token' } }
    )

    const response = await POST(request, { params: Promise.resolve({ importId: 'import-1' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: tableImport })
    expect(mocks.complete).toHaveBeenCalledWith({
      principal,
      input: {
        importId: 'import-1',
        workspaceId: WORKSPACE_ID,
        uploadToken: 'signed-upload-token',
      },
      request,
    })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await POST(
      new NextRequest(
        `http://localhost:3000/api/v2/tables/imports/import-1/complete?workspaceId=${WORKSPACE_ID}`,
        { method: 'POST', headers: { 'upload-token': 'signed-upload-token' } }
      ),
      { params: Promise.resolve({ importId: 'import-1' }) }
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
