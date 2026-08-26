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
  create: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/tables/presenters', () => ({
  presentV2CreateTableImport: (tableImport: unknown) => ({ data: tableImport }),
}))
vi.mock('@/lib/table/application/imports', () => ({
  createTableImportUseCase: { operation: { id: 'tables.imports.create' }, execute: mocks.create },
}))

import { POST } from '@/app/api/v2/tables/imports/route'

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
const timestamp = '2026-01-01T00:00:00.000Z'

describe('POST /api/v2/tables/imports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  })

  it.each([
    [
      'upload',
      { type: 'upload', name: 'data.csv', contentType: 'text/csv', size: 128 },
      {
        session: {
          id: 'import-1',
          workspaceId: WORKSPACE_ID,
          status: 'uploading',
          source: { type: 'upload', name: 'data.csv', contentType: 'text/csv', size: 128 },
          target: { type: 'new', name: 'imported_data' },
          tableId: null,
          rowsProcessed: 0,
          error: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
        },
        uploadToken: 'signed-token',
        transfer: {
          method: 'put',
          url: 'https://storage.example/upload',
          headers: {},
          expiresAt: '2026-01-01T01:00:00.000Z',
        },
      },
    ],
    [
      'workspace file',
      { type: 'workspace_file', fileId: 'file-1' },
      {
        session: {
          id: 'import-1',
          workspaceId: WORKSPACE_ID,
          status: 'processing',
          source: { type: 'workspace_file', fileId: 'file-1' },
          target: { type: 'new', name: 'imported_data' },
          tableId: 'table-1',
          rowsProcessed: 0,
          error: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
        },
        uploadToken: null,
        transfer: null,
      },
    ],
  ])(
    'delegates a %s source to the authorized import use case',
    async (_label, source, tableImport) => {
      const body = {
        workspaceId: WORKSPACE_ID,
        source,
        target: { type: 'new', name: 'imported_data' },
      }
      mocks.create.mockResolvedValue({ import: tableImport })
      const request = new NextRequest('http://localhost:3000/api/v2/tables/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
        body: JSON.stringify(body),
      })

      const response = await POST(request)

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({ data: tableImport })
      expect(mocks.create).toHaveBeenCalledWith({ principal, input: { body }, request })
    }
  )

  it('authenticates and rate-limits before rejecting an invalid source', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/tables/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, source: {}, target: {} }),
      })
    )

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/tables/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          source: { type: 'workspace_file', fileId: 'file-1' },
          target: { type: 'new', name: 'imported_data' },
        }),
      })
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
