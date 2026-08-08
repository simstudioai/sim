/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  preauthRate: vi.fn(),
  operationRate: vi.fn(),
  gate: vi.fn(),
  complete: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))
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
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: [`workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const rate = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00.000Z'),
  retryAfterMs: 0,
}

describe('POST /api/v2/tables/imports/[importId]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.preauthRate.mockResolvedValue(rate)
    mocks.operationRate.mockResolvedValue(rate)
    mocks.gate.mockResolvedValue(null)
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
})
