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
  create: vi.fn(),
  read: vi.fn(),
  download: vi.fn(),
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
  presentV2TableExport: (tableExport: unknown) => ({ data: tableExport }),
}))
vi.mock('@/lib/table/application/exports', () => ({
  createTableExportUseCase: { operation: { id: 'tables.exports.create' }, execute: mocks.create },
  readTableExportUseCase: { operation: { id: 'tables.exports.read' }, execute: mocks.read },
  cancelTableExportUseCase: { operation: { id: 'tables.exports.cancel' }, execute: vi.fn() },
  downloadTableExportUseCase: {
    operation: { id: 'tables.exports.download' },
    execute: mocks.download,
  },
}))

import { POST } from '@/app/api/v2/tables/[tableId]/exports/route'
import { GET as DOWNLOAD } from '@/app/api/v2/tables/exports/[exportId]/download/route'
import { GET as STATUS } from '@/app/api/v2/tables/exports/[exportId]/route'

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
const tableExport = {
  id: 'export-1',
  tableId: 'table-1',
  workspaceId: WORKSPACE_ID,
  format: 'csv' as const,
  status: 'completed' as const,
  rowsProcessed: 2,
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:01:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
}

describe('v2 table exports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(auth)
    mocks.preauthRate.mockResolvedValue(rate)
    mocks.operationRate.mockResolvedValue(rate)
    mocks.gate.mockResolvedValue(null)
  })

  it('creates an export through the authorized use case', async () => {
    mocks.create.mockResolvedValue({ export: tableExport })
    const request = new NextRequest('http://localhost:3000/api/v2/tables/table-1/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, format: 'csv' }),
    })

    const response = await POST(request, { params: Promise.resolve({ tableId: 'table-1' }) })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ data: tableExport })
    expect(mocks.create).toHaveBeenCalledWith({
      principal,
      input: { tableId: 'table-1', workspaceId: WORKSPACE_ID, format: 'csv' },
      request,
    })
  })

  it('reads status and download metadata through separate semantic operations', async () => {
    mocks.read.mockResolvedValue({ export: tableExport })
    mocks.download.mockResolvedValue({
      url: 'https://storage.example/export.csv',
      fileName: 'Contacts.csv',
      expiresAt: '2026-01-01T01:00:00.000Z',
    })
    const statusRequest = new NextRequest(
      `http://localhost:3000/api/v2/tables/exports/export-1?workspaceId=${WORKSPACE_ID}`
    )
    const downloadRequest = new NextRequest(
      `http://localhost:3000/api/v2/tables/exports/export-1/download?workspaceId=${WORKSPACE_ID}`
    )

    const status = await STATUS(statusRequest, {
      params: Promise.resolve({ exportId: 'export-1' }),
    })
    const download = await DOWNLOAD(downloadRequest, {
      params: Promise.resolve({ exportId: 'export-1' }),
    })

    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ data: tableExport })
    expect(download.status).toBe(200)
    expect((await download.json()).data.fileName).toBe('Contacts.csv')
    expect(mocks.read).toHaveBeenCalledWith({
      principal,
      input: { exportId: 'export-1', workspaceId: WORKSPACE_ID },
      request: statusRequest,
    })
    expect(mocks.download).toHaveBeenCalledWith({
      principal,
      input: { exportId: 'export-1', workspaceId: WORKSPACE_ID },
      request: downloadRequest,
    })
  })
})
